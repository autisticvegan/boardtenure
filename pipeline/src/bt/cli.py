"""`bt` — Boardtape pipeline command line."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from bt import db


def cmd_db_migrate(args: argparse.Namespace) -> None:
    with db.session("pipeline:migrate") as conn:
        done = db.migrate(conn)
    print("applied:", ", ".join(done) if done else "nothing (up to date)")


def cmd_ref_init(args: argparse.Namespace) -> None:
    from bt.ingest import reference

    with db.session("pipeline:ref-init") as conn:
        sources = reference.ensure_sources(conn)
        benches = reference.ensure_benchmarks(conn)
    print(json.dumps({"sources": sources, "benchmarks": benches}))


def _security_id(conn, symbol: str) -> int:
    row = conn.execute(
        """SELECT id FROM security WHERE upper(symbol) = upper(%s)
           ORDER BY is_primary DESC, kind = 'etf' DESC LIMIT 1""",
        (symbol,),
    ).fetchone()
    if not row:
        raise SystemExit(f"unknown security {symbol!r}; create the company/benchmark first")
    return row["id"]


def cmd_prices_load_csv(args: argparse.Namespace) -> None:
    from bt.ingest import prices, reference

    with db.session("pipeline:prices-load") as conn:
        sid = _security_id(conn, args.symbol)
        src = reference.source_ids(conn).get(args.source)
        if src is None:
            raise SystemExit(f"unknown source {args.source!r}")
        n = prices.upsert_bars(conn, sid, prices.read_bars_csv(Path(args.csv)), src)
        idx = prices.reindex(conn, sid, full=True)
    print(f"{args.symbol}: {n} bars upserted, {idx} index points")


def cmd_prices_load_actions(args: argparse.Namespace) -> None:
    from bt.ingest import prices, reference

    with db.session("pipeline:actions-load") as conn:
        sid = _security_id(conn, args.symbol)
        src = reference.source_ids(conn).get(args.source)
        if src is None:
            raise SystemExit(f"unknown source {args.source!r}")
        changed = prices.upsert_actions(conn, sid, prices.read_actions_csv(Path(args.csv)), src, args.confidence)
        idx = prices.reindex(conn, sid, full=True) if changed else 0
    print(f"{args.symbol}: {changed} actions new/changed, {idx} index points rebuilt")


def cmd_prices_reindex(args: argparse.Namespace) -> None:
    from bt.ingest import prices

    with db.session("pipeline:prices-reindex") as conn:
        ids = [_security_id(conn, s) for s in args.symbols] if args.symbols else \
            [r["id"] for r in conn.execute("SELECT DISTINCT security_id AS id FROM price_daily")]
        for sid in ids:
            print(sid, prices.reindex(conn, sid, full=args.full))


def cmd_analytics_recompute(args: argparse.Namespace) -> None:
    from bt.analytics import board_pay, event_study, exec_pay, insider_sales, pay_asymmetry, tenure

    with db.session("pipeline:analytics") as conn:
        ids = None
        if args.company:
            ids = [conn.execute("SELECT id FROM company WHERE slug = %s", (args.company.lower(),))
                   .fetchone()["id"]]
        print("tenure rows:", tenure.recompute(conn, ids))
        print("executive performance rows:", exec_pay.recompute(conn, ids))
        print("board pay years:", board_pay.recompute(conn))
        print("board change events:", event_study.recompute(conn))
        print("executive sales windows:", insider_sales.recompute(conn))
        print("same-CEO pay changes:", pay_asymmetry.recompute(conn))


def cmd_seed_board(args: argparse.Namespace) -> None:
    from bt.ingest import seed_board

    with db.session("pipeline:seed-board", reason=f"load {Path(args.path).name}") as conn:
        st = seed_board.load(conn, Path(args.path))
    print(json.dumps(st.__dict__, indent=1, default=str))
    if st.unverified:
        print(f"WARNING: {len(st.unverified)} quotes failed verification; their facts are capped at low confidence",
              file=sys.stderr)


def cmd_quality_run(args: argparse.Namespace) -> None:
    from bt.quality import checks

    with db.session("pipeline:quality") as conn:
        counts = checks.run(conn)
    print(json.dumps({k: v for k, v in counts.items() if v}, indent=1))


def cmd_sec_sync(args: argparse.Namespace) -> None:
    from bt.config import settings
    from bt.jobs.sec_sync import sync_company
    from bt.sources.sec import Edgar

    edgar = Edgar(settings().require_sec_user_agent())
    with db.session("pipeline:sec-sync") as conn:
        rows = conn.execute(
            "SELECT id, slug, cik FROM company WHERE cik IS NOT NULL AND (%s::text IS NULL OR slug = %s)",
            (args.company, args.company)).fetchall()
        for c in rows:
            print(c["slug"], json.dumps(sync_company(conn, edgar, c["id"], c["cik"])))


def cmd_sec_shares(args: argparse.Namespace) -> None:
    from bt.config import settings
    from bt.ingest import shares
    from bt.sources.sec import Edgar

    # History walks every 10-K/10-Q; stay well under EDGAR's limit alongside other fetchers.
    edgar = Edgar(settings().require_sec_user_agent(), max_rps=2 if args.history else 5.0)
    with db.session("pipeline:sec-shares") as conn:
        for c in conn.execute("SELECT id, slug, cik FROM company WHERE cik IS NOT NULL ORDER BY slug").fetchall():
            if args.history and c["slug"] not in args.history:
                continue
            if args.history:
                rows = shares.load_history(conn, edgar, c["id"], c["cik"])
                older = shares.load_companyfacts(conn, edgar, c["id"], c["cik"])
                print(c["slug"], f"{len(rows)} cover dates", rows[-1]["as_of"] if rows else None, "→",
                      rows[0]["as_of"] if rows else None, f"+ {older} older from XBRL company facts")
            else:
                print(c["slug"], shares.update_company(conn, edgar, c["id"], c["cik"]))
            conn.commit()


def cmd_screen_pvp(args: argparse.Namespace) -> None:
    from bt.config import settings
    from bt.ingest import screen
    from bt.sources.sec import Edgar

    edgar = Edgar(settings().require_sec_user_agent(), max_rps=2)
    with db.session("pipeline:screen-pvp") as conn:
        print("tickers:", screen.load_tickers(conn, edgar))
        stats = screen.load_frames(conn, edgar)
        print(json.dumps(stats, indent=1))
        print("public float facts:", screen.load_float_frames(conn, edgar))
        n = conn.execute("SELECT count(*) AS n FROM pvp_screen").fetchone()["n"]
        print("companies screened:", n)
        cases = screen.check_cases(conn, edgar, args.top, gaps=args.gaps)
        ok = [c for c in cases if "error" not in c]
        print(f"cases checked: {len(ok)}, verified: {sum(1 for c in ok if not c['mismatches'] and c['checked'])}, "
              f"per-person CEO facts: {sum(c['peo_facts'] for c in ok)}, errors: {len(cases) - len(ok)}")


def cmd_screen_panel(args: argparse.Namespace) -> None:
    from bt.config import settings
    from bt.ingest import screen
    from bt.sources.sec import Edgar

    edgar = Edgar(settings().require_sec_user_agent(), max_rps=2)
    with db.session("pipeline:screen-panel") as conn:
        print(json.dumps(screen.load_panel(conn, edgar, args.limit, args.reverse), indent=1))


def cmd_screen_discover(args: argparse.Namespace) -> None:
    from bt.config import settings
    from bt.ingest import screen
    from bt.sources.sec import Edgar

    edgar = Edgar(settings().require_sec_user_agent(), max_rps=2)
    with db.session("pipeline:screen-discover") as conn:
        print(json.dumps(screen.discover(conn, edgar, args.limit, args.reverse), indent=1))


def cmd_screen_ratios(args: argparse.Namespace) -> None:
    from bt.ingest import pay_ratio

    with db.session("pipeline:pay-ratio") as conn:
        print(json.dumps(pay_ratio.extract(conn), indent=1))


def cmd_logos_fetch(args: argparse.Namespace) -> None:
    from bt.ingest import logos

    with db.session("pipeline:logos") as conn:
        print(json.dumps(logos.fetch(conn, refresh=args.refresh, limit=args.limit), indent=1))
        print("from proxies:", json.dumps(logos.fill_from_proxies(conn)))
        print("tones classified:", logos.classify(conn))


def cmd_insiders_load(args: argparse.Namespace) -> None:
    """Forms 4/5 transactions for every named executive with pay on file at the given companies."""
    from datetime import date

    from bt.config import settings
    from bt.ingest import insider_tx
    from bt.sources.sec import Edgar

    edgar = Edgar(settings().require_sec_user_agent(), max_rps=2)
    with db.session("pipeline:insiders") as conn:
        people = conn.execute(
            """SELECT DISTINCT c.id AS company_id, c.slug, c.cik, p.id AS person_id, p.full_name, pi.value AS owner_cik
               FROM executive_comp ec JOIN company c ON c.id = ec.company_id JOIN person p ON p.id = ec.person_id
               JOIN person_identifier pi ON pi.person_id = p.id AND pi.scheme = 'sec_cik'
               WHERE c.slug = ANY(%s) ORDER BY c.slug, p.full_name""", (args.companies,)).fetchall()
        for r in people:
            n = insider_tx.load_owner(conn, edgar, r["person_id"], r["owner_cik"], r["company_id"], r["cik"],
                                      date(args.since, 1, 1))
            print(r["slug"], r["full_name"], n)


def cmd_sec_index(args: argparse.Namespace) -> None:
    """Store every filing's form, date and 8-K items for tracked companies (EDGAR submissions)."""
    from bt.config import settings
    from bt.sources.sec import Edgar

    edgar = Edgar(settings().require_sec_user_agent(), max_rps=2)
    with db.session("pipeline:sec-index") as conn:
        for c in conn.execute("SELECT slug, cik FROM company WHERE cik IS NOT NULL ORDER BY slug").fetchall():
            rows = [(int(c["cik"]), f.accession, f.form, f.filing_date, list(f.items))
                    for f in edgar.filings(c["cik"], include_history=True)]
            with conn.cursor() as cur:
                cur.executemany(
                    """INSERT INTO filing_index (cik, accession, form, filing_date, items) VALUES (%s, %s, %s, %s, %s)
                       ON CONFLICT (cik, accession) DO UPDATE SET items = EXCLUDED.items""", rows)
            conn.commit()
            print(c["slug"], len(rows))


def cmd_refresh(args: argparse.Namespace) -> None:
    from bt.jobs import refresh

    with db.session("pipeline:refresh") as conn:
        stats = refresh.run(conn, skip_prices=args.skip_prices, skip_sec=args.skip_sec)
    print(json.dumps(stats, indent=1, default=str))


def cmd_seed_all(args: argparse.Namespace) -> None:
    """Load every researched board file and prototype price file, then recompute and validate."""
    from bt.analytics import board_pay, event_study, exec_pay, insider_sales, pay_asymmetry, tenure
    from bt.ingest import (
        prices,
        reference,
        seed_board,
        seed_board_pay,
        seed_comp,
        seed_failing_up,
        seed_hiw_cases,
        seed_parachutes,
    )
    from bt.quality import checks

    seed_dir = Path(args.dir)
    with db.session("pipeline:seed-all") as conn:
        reference.ensure_sources(conn)
        reference.ensure_benchmarks(conn)
        conn.commit()
        for path in sorted(seed_dir.glob("*_board_research.json")):
            failures = seed_board.verify_file(path)
            if failures:
                print(f"SKIP {path.name}: {len(failures)} verification problem(s), first: {failures[0]}")
                continue
            st = seed_board.load(conn, path)
            conn.commit()
            print(f"{path.name}: {st.people} people, {st.memberships} seats, "
                  f"{st.verified}/{st.evidence} quotes verified")
        for path in sorted(seed_dir.glob("*_board_pay_research.json")):
            blocking = [f for f in seed_board_pay.verify_file(path) if not f.startswith("WARN")]
            if blocking:
                print(f"SKIP {path.name}: {len(blocking)} verification problem(s), first: {blocking[0]}")
                continue
            bst = seed_board_pay.load(conn, path)
            conn.commit()
            print(f"{path.name}: {bst.director_rows} director rows, {bst.exits} exits")
        for path in sorted(seed_dir.glob("*_exec_comp_research.json")):
            blocking = [f for f in seed_comp.verify_file(path) if not f.startswith("WARN")]
            if blocking:
                print(f"SKIP {path.name}: {len(blocking)} verification problem(s), first: {blocking[0]}")
                continue
            cst = seed_comp.load(conn, path)
            conn.commit()
            print(f"{path.name}: {cst.positions} positions, {cst.comp_rows} pay rows, "
                  f"{cst.board.verified}/{cst.board.evidence} quotes verified")
        for prefix, mod in (("golden_parachutes_", seed_parachutes), ("failing_up", seed_failing_up),
                            ("hiw_", seed_hiw_cases)):
            for path in sorted(seed_dir.glob(f"{prefix}*.json")):
                blocking = [f for f in mod.verify_file(path) if not f.startswith("WARN")]
                if blocking:
                    print(f"SKIP {path.name}: {len(blocking)} verification problem(s), first: {blocking[0]}")
                    continue
                print(f"{path.name}: {mod.load(conn, path)} cases")
                conn.commit()
        src = reference.source_ids(conn)
        for csv_path in sorted((seed_dir / "prices").glob("*.csv")):
            if csv_path.stem.endswith("_actions"):
                continue
            symbol = csv_path.stem
            row = conn.execute(
                """SELECT id FROM security WHERE upper(symbol) = %s AND (is_primary OR kind = 'etf')
                   ORDER BY is_primary DESC LIMIT 1""", (symbol.upper(),)).fetchone()
            if not row:
                print(f"skip prices {symbol}: no tracked security")
                continue
            bars = prices.read_bars_csv(csv_path)
            prices.upsert_bars(conn, row["id"], bars, src["prototype_keyless"])
            actions_path = csv_path.with_name(f"{symbol}_actions.csv")
            n_actions = 0
            if actions_path.exists():
                action_src = src["ssga"] if symbol.upper() == "SPY" else src["prototype_keyless"]
                n_actions = prices.upsert_actions(conn, row["id"], prices.read_actions_csv(actions_path), action_src,
                                                  "high" if symbol.upper() == "SPY" else "medium")
            prices.reindex(conn, row["id"], full=True)
            conn.commit()
            print(f"prices {symbol}: {len(bars)} bars {bars[0].day if bars else ''}..{bars[-1].day if bars else ''}, "
                  f"{n_actions} actions new/changed")
        print("tenure rows:", tenure.recompute(conn))
        print("executive performance rows:", exec_pay.recompute(conn))
        print("board pay years:", board_pay.recompute(conn))
        print("board change events:", event_study.recompute(conn))
        print("executive sales windows:", insider_sales.recompute(conn))
        print("same-CEO pay changes:", pay_asymmetry.recompute(conn))
        issues = {k: v for k, v in checks.run(conn).items() if v}
        print("quality:", json.dumps(issues))


def cmd_seed_verify(args: argparse.Namespace) -> None:
    from bt.ingest import seed_board, seed_board_pay, seed_comp, seed_failing_up, seed_hiw_cases, seed_parachutes

    path = Path(args.path)
    mod = (seed_comp if path.name.endswith("_exec_comp_research.json")
           else seed_board_pay if path.name.endswith("_board_pay_research.json")
           else seed_parachutes if path.name.startswith("golden_parachutes_")
           else seed_failing_up if path.name.startswith("failing_up")
           else seed_hiw_cases if path.name.startswith("hiw_") else seed_board)
    failures = mod.verify_file(path)
    for f in failures:
        print(f)
    blocking = [f for f in failures if not f.startswith("WARN")]
    print(f"{len(blocking)} problem(s), {len(failures) - len(blocking)} warning(s)")
    sys.exit(1 if blocking else 0)


def cmd_seed_board_pay(args: argparse.Namespace) -> None:
    from bt.ingest import seed_board_pay

    path = Path(args.path)
    blocking = [f for f in seed_board_pay.verify_file(path) if not f.startswith("WARN")]
    if blocking:
        print("\n".join(blocking))
        sys.exit(f"{len(blocking)} verification problem(s); nothing loaded")
    with db.session("pipeline:seed-board-pay") as conn:
        st = seed_board_pay.load(conn, path)
        print(f"{path.name}: {st.director_rows} director pay rows, {st.exits} exits, "
              f"{st.board.verified}/{st.board.evidence} quotes verified")


def cmd_seed_failing_up(args: argparse.Namespace) -> None:
    from bt.ingest import seed_failing_up

    paths = [Path(args.path)] if args.path else sorted(Path(args.dir).glob("failing_up*.json"))
    for path in paths:
        problems = seed_failing_up.verify_file(path)
        if problems:
            print("\n".join(problems))
            sys.exit(f"{path.name}: {len(problems)} verification problem(s); nothing loaded")
    with db.session("pipeline:seed-failing-up") as conn:
        for path in paths:
            print(f"{path.name}: {seed_failing_up.load(conn, path)} cases")


def cmd_seed_hiw(args: argparse.Namespace) -> None:
    from bt.ingest import seed_hiw_cases

    paths = sorted(Path(args.dir).glob("hiw_*.json"))
    for path in paths:
        problems = seed_hiw_cases.verify_file(path)
        if problems:
            print("\n".join(problems))
            sys.exit(f"{path.name}: {len(problems)} verification problem(s); nothing loaded")
    with db.session("pipeline:seed-hiw") as conn:
        for path in paths:
            print(f"{path.name}: {seed_hiw_cases.load(conn, path)} cases")


def cmd_seed_parachutes(args: argparse.Namespace) -> None:
    from bt.ingest import seed_parachutes

    paths = sorted(Path(args.dir).glob("golden_parachutes_*.json"))
    with db.session("pipeline:seed-parachutes") as conn:
        for path in paths:
            problems = [p for p in seed_parachutes.verify_file(path) if not p.startswith("WARN")]
            if problems:
                print(f"SKIP {path.name}: {len(problems)} problem(s), first: {problems[0]}")
                continue
            print(f"{path.name}: {seed_parachutes.load(conn, path)} cases")
            conn.commit()


def cmd_seed_comp(args: argparse.Namespace) -> None:
    from bt.analytics import exec_pay
    from bt.ingest import seed_comp

    path = Path(args.path)
    blocking = [f for f in seed_comp.verify_file(path) if not f.startswith("WARN")]
    if blocking:
        print("\n".join(blocking))
        sys.exit(f"{len(blocking)} verification problem(s); nothing loaded")
    with db.session("pipeline:seed-comp") as conn:
        st = seed_comp.load(conn, path)
        print(f"{path.name}: {st.people} people, {st.positions} positions, {st.comp_rows} pay rows, "
              f"{st.pvp_rows} pay-vs-performance rows, {st.board.verified}/{st.board.evidence} quotes verified")
        print("executive performance rows:", exec_pay.recompute(conn))


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="bt", description=__doc__)
    sub = p.add_subparsers(required=True)

    dbp = sub.add_parser("db").add_subparsers(required=True)
    dbp.add_parser("migrate", help="apply pending migrations").set_defaults(fn=cmd_db_migrate)

    ref = sub.add_parser("ref").add_subparsers(required=True)
    ref.add_parser("init", help="ensure sources and benchmarks").set_defaults(fn=cmd_ref_init)

    pr = sub.add_parser("prices").add_subparsers(required=True)
    lc = pr.add_parser("load-csv", help="load daily bars from a CSV")
    lc.add_argument("--symbol", required=True)
    lc.add_argument("--csv", required=True)
    lc.add_argument("--source", required=True, help="source code, e.g. stooq")
    lc.set_defaults(fn=cmd_prices_load_csv)
    la = pr.add_parser("load-actions", help="load splits/dividends from a CSV")
    la.add_argument("--symbol", required=True)
    la.add_argument("--csv", required=True)
    la.add_argument("--source", required=True)
    la.add_argument("--confidence", default="high", choices=["high", "medium", "low"])
    la.set_defaults(fn=cmd_prices_load_actions)
    ri = pr.add_parser("reindex", help="rebuild total-return indexes")
    ri.add_argument("symbols", nargs="*")
    ri.add_argument("--full", action="store_true")
    ri.set_defaults(fn=cmd_prices_reindex)

    sd = sub.add_parser("seed").add_subparsers(required=True)
    sb = sd.add_parser("board", help="load a researched board JSON file")
    sb.add_argument("path")
    sb.set_defaults(fn=cmd_seed_board)
    sa = sd.add_parser("all", help="load every board file and prototype price file, recompute, validate")
    sa.add_argument("--dir", default=str(Path(__file__).resolve().parents[3] / "data" / "seed"))
    sa.set_defaults(fn=cmd_seed_all)
    sbp = sd.add_parser("board-pay", help="load a researched director-pay and exit-package JSON file")
    sbp.add_argument("path")
    sbp.set_defaults(fn=cmd_seed_board_pay)
    sfu = sd.add_parser("failing-up", help="load every data/seed/failing_up*.json file (or one PATH)")
    sfu.add_argument("path", nargs="?")
    sfu.add_argument("--dir", default=str(Path(__file__).resolve().parents[3] / "data" / "seed"))
    sfu.set_defaults(fn=cmd_seed_failing_up)
    shc = sd.add_parser("hiw", help="load every data/seed/hiw_*.json file (golden hellos, layoffs)")
    shc.add_argument("--dir", default=str(Path(__file__).resolve().parents[3] / "data" / "seed"))
    shc.set_defaults(fn=cmd_seed_hiw)
    sgp = sd.add_parser("parachutes", help="load every data/seed/golden_parachutes_*.json file")
    sgp.add_argument("--dir", default=str(Path(__file__).resolve().parents[3] / "data" / "seed"))
    sgp.set_defaults(fn=cmd_seed_parachutes)
    sc = sd.add_parser("comp", help="load a researched executive-pay JSON file and recompute executive performance")
    sc.add_argument("path")
    sc.set_defaults(fn=cmd_seed_comp)
    sv = sd.add_parser("verify", help="verify a board JSON file's quotes against cached filings (no DB)")
    sv.add_argument("path")
    sv.set_defaults(fn=cmd_seed_verify)

    qp = sub.add_parser("quality").add_subparsers(required=True)
    qp.add_parser("run", help="run data-quality checks").set_defaults(fn=cmd_quality_run)

    sp = sub.add_parser("sec").add_subparsers(required=True)
    ss = sp.add_parser("sync", help="discover and process new EDGAR filings")
    ss.add_argument("--company")
    ss.set_defaults(fn=cmd_sec_sync)

    sp.add_parser("index", help="store every filing's form, date and 8-K items for tracked companies").set_defaults(
        fn=cmd_sec_index)
    sh = sp.add_parser("shares", help="refresh shares outstanding from latest 10-K/10-Q covers")
    sh.add_argument("--history", nargs="+", metavar="SLUG",
                    help="load every 10-K/10-Q cover for these companies instead of the latest")
    sh.set_defaults(fn=cmd_sec_shares)

    ip = sub.add_parser("insiders").add_subparsers(required=True)
    il = ip.add_parser("load", help="load Forms 4/5 transactions for named executives at these companies")
    il.add_argument("companies", nargs="+", metavar="SLUG")
    il.add_argument("--since", type=int, default=2016, help="first filing year")
    il.set_defaults(fn=cmd_insiders_load)

    scp = sub.add_parser("screen").add_subparsers(required=True)
    sp_pvp = scp.add_parser("pvp", help="load every filer's pay-versus-performance facts from SEC XBRL frames")
    sp_pvp.add_argument("--top", type=int, default=60, help="how many top cases to verify against their proxy")
    sp_pvp.add_argument("--gaps", action="store_true",
                        help="also read per-person CEO pay from the proxy of every company missing CEO years")
    sp_pvp.set_defaults(fn=cmd_screen_pvp)
    sp_pan = scp.add_parser("panel", help="read each screened company's latest proxy into the year-by-year CEO panel")
    sp_pan.add_argument("--limit", type=int, help="at most this many filings (default: all not yet read)")
    sp_pan.add_argument("--reverse", action="store_true", help="work from the highest CIK down")
    sp_pan.set_defaults(fn=cmd_screen_panel)
    sp_dis = scp.add_parser("discover", help="read proxies of well-known companies missing from the frames")
    sp_dis.add_argument("--limit", type=int)
    sp_dis.add_argument("--reverse", action="store_true", help="work from the highest CIK down")
    sp_dis.set_defaults(fn=cmd_screen_discover)
    sp_rat = scp.add_parser("ratios", help="read CEO pay ratios from the cached latest proxies (run after panel)")
    sp_rat.set_defaults(fn=cmd_screen_ratios)

    lg = sub.add_parser("logos").add_subparsers(required=True)
    lf = lg.add_parser("fetch", help="fetch company icons (Wikidata website -> site icon, else Commons logo)")
    lf.add_argument("--refresh", action="store_true", help="re-fetch companies already on file")
    lf.add_argument("--limit", type=int)
    lf.set_defaults(fn=cmd_logos_fetch)

    dp = sub.add_parser("refresh", help="run the scheduled (weekly) refresh: prices, filings, analytics, checks")
    dp.add_argument("--skip-prices", action="store_true")
    dp.add_argument("--skip-sec", action="store_true")
    dp.set_defaults(fn=cmd_refresh)

    an = sub.add_parser("analytics").add_subparsers(required=True)
    rc = an.add_parser("recompute", help="recompute tenure performance")
    rc.add_argument("--company", help="company slug (default: all)")
    rc.set_defaults(fn=cmd_analytics_recompute)
    return p


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    args.fn(args)


if __name__ == "__main__":
    main(sys.argv[1:])
