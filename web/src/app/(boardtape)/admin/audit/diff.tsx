const SKIP = new Set(["updated_at", "created_at"]);

export function AuditDiff({ oldRow, newRow }: { oldRow: Record<string, unknown> | null; newRow: Record<string, unknown> | null }) {
  const keys = [...new Set([...Object.keys(oldRow ?? {}), ...Object.keys(newRow ?? {})])].filter((k) => !SKIP.has(k));
  const changed = keys.filter((k) => JSON.stringify(oldRow?.[k]) !== JSON.stringify(newRow?.[k]));
  if (!oldRow || !newRow || changed.length === 0) return null;
  return (
    <table className="mt-1 text-[12px] font-mono">
      <tbody>
        {changed.map((k) => (
          <tr key={k}>
            <td className="pr-3 text-ink-3">{k}</td>
            <td className="pr-3 text-neg line-through">{JSON.stringify(oldRow[k])}</td>
            <td className="text-pos">{JSON.stringify(newRow[k])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
