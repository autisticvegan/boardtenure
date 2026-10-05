"""`bt` — BoardTenure pipeline command line."""

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
    from bt.analytics import tenure

    with db.session("pipeline:analytics") as conn:
        ids = None
        if args.company:
            ids = [conn.execute("SELECT id FROM company WHERE slug = %s", (args.company.lower(),))
                   .fetchone()["id"]]
        print("tenure rows:", tenure.recompute(conn, ids))


def cmd_seed_board(args: argparse.Namespace) -> None:
    from bt.ingest import seed_board

    with db.session("pipeline:seed-board", reason=f"load {Path(args.path).name}") as conn:
        st = seed_board.load(conn, Path(args.path))
    print(json.dumps(st.__dict__, indent=1, default=str))
    if st.unverified:
        print(f"WARNING: {len(st.unverified)} quotes failed verification; their facts are capped at low confidence",
              file=sys.stderr)


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
