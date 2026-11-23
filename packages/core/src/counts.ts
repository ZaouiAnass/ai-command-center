/** Extrait un décompte de tests des sorties usuelles (vitest, jest, cargo, pytest). Retourne null si le format n'est pas reconnu : jamais de chiffres inventés. */
export function parseCounts(out: string): { passed: number; failed: number; total: number } | null {
  const n = (s: string, re: RegExp) => { const m = re.exec(s); return m ? Number(m[1]) : 0; };
  const vt = /^\s*Tests\s+(\d.*\(\d+\))\s*$/m.exec(out); // vitest : "Tests  1 failed | 106 passed (107)"
  if (vt) { const l = vt[1]!; return { passed: n(l, /(\d+) passed/), failed: n(l, /(\d+) failed/), total: n(l, /\((\d+)\)/) }; }
  const jt = /Tests:\s+(.*?)(\d+) total/.exec(out); // jest
  if (jt) return { failed: n(jt[1]!, /(\d+) failed/), passed: n(jt[1]!, /(\d+) passed/), total: Number(jt[2]) };
  const ct = /test result: \w+\. (\d+) passed; (\d+) failed/.exec(out); // cargo
  if (ct) return { passed: Number(ct[1]), failed: Number(ct[2]), total: Number(ct[1]) + Number(ct[2]) };
  const pt = /(?:^|\n)=+ (.*?(?:passed|failed).*?) in [\d.]+s/.exec(out) ?? /(?:^|\n)(\d+ (?:passed|failed)[^\n]*) in [\d.]+s/.exec(out); // pytest
  if (pt) { const passed = n(pt[1]!, /(\d+) passed/), failed = n(pt[1]!, /(\d+) failed/); return { passed, failed, total: passed + failed }; }
  return null;
}
