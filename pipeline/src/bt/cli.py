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
    from bt.analytics import board_pay, event_study, exec_pay, tenure

    with db.session("pipeline:analytics") as conn:
        ids = None
        if args.company:
            ids = [conn.execute("SELECT id FROM company WHERE slug = %s", (args.company.lower(),))
                   .fetchone()["id"]]
        print("tenure rows:", tenure.recompute(conn, ids))
        print("executive performance rows:", exec_pay.recompute(conn, ids))
        print("board pay years:", board_pay.recompute(conn))
        print("board change events:", event_study.recompute(conn))


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
        n = conn.execute("SELECT count(*) AS n FROM pvp_screen").fetchone()["n"]
        print("companies screened:", n)
        cases = screen.check_cases(conn, edgar, args.top)
        print(f"cases checked: {len(cases)}, verified: {sum(1 for c in cases if not c['mismatches'] and c['checked'])}")


def cmd_refresh(args: argparse.Namespace) -> None:
    from bt.jobs import refresh

    with db.session("pipeline:refresh") as conn:
        stats = refresh.run(conn, skip_prices=args.skip_prices, skip_sec=args.skip_sec)
    print(json.dumps(stats, indent=1, default=str))


def cmd_seed_all(args: argparse.Namespace) -> None:
    """Load every researched board file and prototype price file, then recompute and validate."""
    from bt.analytics import board_pay, event_study, exec_pay, tenure
    from bt.ingest import prices, reference, seed_board, seed_board_pay, seed_comp
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
        issues = {k: v for k, v in checks.run(conn).items() if v}
        print("quality:", json.dumps(issues))


def cmd_seed_verify(args: argparse.Namespace) -> None:
    from bt.ingest import seed_board, seed_board_pay, seed_comp

    path = Path(args.path)
    mod = (seed_comp if path.name.endswith("_exec_comp_research.json")
           else seed_board_pay if path.name.endswith("_board_pay_research.json") else seed_board)
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

    path = Path(args.path)
    problems = seed_failing_up.verify_file(path)
    if problems:
        print("\n".join(problems))
        sys.exit(f"{len(problems)} verification problem(s); nothing loaded")
    with db.session("pipeline:seed-failing-up") as conn:
        print(f"{path.name}: {seed_failing_up.load(conn, path)} cases")


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
    sfu = sd.add_parser("failing-up", help="load the researched failing-up cases JSON file")
    sfu.add_argument("path")
    sfu.set_defaults(fn=cmd_seed_failing_up)
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

    sh = sp.add_parser("shares", help="refresh shares outstanding from latest 10-K/10-Q covers")
    sh.add_argument("--history", nargs="+", metavar="SLUG",
                    help="load every 10-K/10-Q cover for these companies instead of the latest")
    sh.set_defaults(fn=cmd_sec_shares)

    scp = sub.add_parser("screen").add_subparsers(required=True)
    sp_pvp = scp.add_parser("pvp", help="load every filer's pay-versus-performance facts from SEC XBRL frames")
    sp_pvp.add_argument("--top", type=int, default=60, help="how many top cases to verify against their proxy")
    sp_pvp.set_defaults(fn=cmd_screen_pvp)

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
