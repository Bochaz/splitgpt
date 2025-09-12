import React, { useEffect, useMemo, useState } from "react";

// TripSplit – divisor de gastos simple, 100% en el navegador
// - Agregá personas
// - Cargá gastos (quién pagó, cuánto, a quiénes incluye y cómo dividir)
// - Calcula saldos y propone transferencias mínimas
// - Botón para generar link compartible (estado codificado en la URL #hash)
// - Exportar/Importar JSON
// Estilo: Tailwind. Sin dependencias externas.

// ---------- Utilidades ----------
const uid = () => Math.random().toString(36).slice(2, 9);

function formatAmount(n) {
  if (Number.isNaN(n) || n === null || n === undefined) return "0";
  return Number(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function parseAmount(s) {
  if (typeof s === "number") return s;
  if (!s) return 0;
  // Reemplaza coma por punto, ignora separadores
  const clean = String(s).replace(/[^0-9,.-]/g, "").replace(",", ".");
  const n = parseFloat(clean);
  return Number.isFinite(n) ? n : 0;
}

function encodeStateForURL(state) {
  try {
    const json = JSON.stringify(state);
    const b64 = btoa(unescape(encodeURIComponent(json)));
    return `#data=${b64}`;
  } catch (e) {
    console.error(e);
    return "";
  }
}

function decodeStateFromURL() {
  try {
    const hash = window.location.hash || "";
    const m = hash.match(/#data=([A-Za-z0-9+/=\-_]+)/);
    if (!m) return null;
    const json = decodeURIComponent(escape(atob(m[1])));
    return JSON.parse(json);
  } catch (e) {
    console.error(e);
    return null;
  }
}

// Greedy settlement: minimiza número de transferencias de forma aproximada
function computeSettlements(balances) {
  // balances: {id -> net}
  const debtors = [];
  const creditors = [];
  Object.entries(balances).forEach(([id, net]) => {
    if (Math.abs(net) < 1e-8) return;
    if (net < 0) debtors.push({ id, amount: -net });
    if (net > 0) creditors.push({ id, amount: net });
  });
  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const transfers = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i];
    const c = creditors[j];
    const amt = Math.min(d.amount, c.amount);
    transfers.push({ from: d.id, to: c.id, amount: amt });
    d.amount -= amt;
    c.amount -= amt;
    if (d.amount <= 1e-8) i++;
    if (c.amount <= 1e-8) j++;
  }
  return transfers;
}

// ---------- Componentes UI ----------
function Section({ title, children, right }) {
  return (
    <section className="bg-white rounded-2xl shadow p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function Chip({ children }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium">
      {children}
    </span>
  );
}

function Input({ label, ...props }) {
  return (
    <label className="block">
      {label && <div className="text-sm text-gray-600 mb-1">{label}</div>}
      <input
        {...props}
        className={`w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring focus:border-black ${props.className || ""}`}
      />
    </label>
  );
}

function Select({ label, children, ...props }) {
  return (
    <label className="block">
      {label && <div className="text-sm text-gray-600 mb-1">{label}</div>}
      <select
        {...props}
        className={`w-full border rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring focus:border-black ${props.className || ""}`}
      >
        {children}
      </select>
    </label>
  );
}

// ---------- App principal ----------
export default function App() {
  const urlState = decodeStateFromURL();
  const [currency, setCurrency] = useState(urlState?.currency ?? "$”);
  const [participants, setParticipants] = useState(urlState?.participants ?? [
    { id: uid(), name: "Ana" },
    { id: uid(), name: "Juan" },
  ]);
  const [expenses, setExpenses] = useState(urlState?.expenses ?? []);

  // Persistir en localStorage
  useEffect(() => {
    const payload = { currency, participants, expenses };
    localStorage.setItem("tripsplit", JSON.stringify(payload));
  }, [currency, participants, expenses]);

  // Cargar localStorage si no vino por URL
  useEffect(() => {
    if (urlState) return;
    const raw = localStorage.getItem("tripsplit");
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.participants) {
          setParticipants(parsed.participants);
          setExpenses(parsed.expenses || []);
          setCurrency(parsed.currency ?? "$");
        }
      } catch {}
    }
  }, []);

  const addParticipant = (name) => {
    if (!name?.trim()) return;
    setParticipants((p) => [...p, { id: uid(), name: name.trim() }]);
  };

  const removeParticipant = (id) => {
    setParticipants((list) => list.filter((p) => p.id !== id));
    setExpenses((list) =>
      list.map((e) => {
        const involvedIds = e.involvedIds?.filter((pid) => pid !== id) || [];
        const split = sanitizeSplitForParticipants(e.split, involvedIds);
        const payerId = e.payerId === id ? null : e.payerId;
        return { ...e, involvedIds, split, payerId };
      })
    );
  };

  function sanitizeSplitForParticipants(split, involvedIds) {
    const set = new Set(involvedIds);
    if (!split) return { mode: "equal" };
    const clone = JSON.parse(JSON.stringify(split));
    if (clone.shares) Object.keys(clone.shares).forEach((k) => !set.has(k) && delete clone.shares[k]);
    if (clone.percents) Object.keys(clone.percents).forEach((k) => !set.has(k) && delete clone.percents[k]);
    if (clone.exact) Object.keys(clone.exact).forEach((k) => !set.has(k) && delete clone.exact[k]);
    return clone;
  }

  const [newName, setNewName] = useState("");

  // ----- Gastos -----
  const emptyExpense = () => ({
    id: uid(),
    desc: "",
    amount: 0,
    date: new Date().toISOString().slice(0, 10),
    payerId: participants[0]?.id || null,
    involvedIds: participants.map((p) => p.id),
    split: { mode: "equal" },
  });
  const [draft, setDraft] = useState(emptyExpense());

  useEffect(() => {
    // Si cambian participantes iniciales
    setDraft((d) => ({ ...d, payerId: d.payerId ?? participants[0]?.id || null }));
  }, [participants]);

  const addExpense = () => {
    if (!draft.payerId || !draft.amount || draft.amount <= 0) return;
    const normalized = { ...draft, amount: parseAmount(draft.amount) };
    setExpenses((e) => [normalized, ...e]);
    setDraft(emptyExpense());
  };

  const removeExpense = (id) => setExpenses((e) => e.filter((x) => x.id !== id));

  // ----- Cálculo de balances -----
  const { balances, totals } = useMemo(() => {
    const bal = {};
    participants.forEach((p) => (bal[p.id] = 0));

    expenses.forEach((e) => {
      const amt = parseAmount(e.amount);
      if (!amt || amt <= 0) return;
      const involved = (e.involvedIds || []).filter((id) => participants.find((p) => p.id === id));
      if (involved.length === 0) return;

      let perHead = {};
      if (e.split?.mode === "equal") {
        const share = amt / involved.length;
        involved.forEach((id) => (perHead[id] = share));
      } else if (e.split?.mode === "shares") {
        const totalShares = involved.reduce((acc, id) => acc + (parseAmount(e.split.shares?.[id]) || 0), 0);
        involved.forEach((id) => {
          const s = parseAmount(e.split.shares?.[id]) || 0;
          perHead[id] = totalShares > 0 ? (amt * s) / totalShares : 0;
        });
      } else if (e.split?.mode === "percent") {
        const totalPct = involved.reduce((acc, id) => acc + (parseAmount(e.split.percents?.[id]) || 0), 0);
        involved.forEach((id) => {
          const p = parseAmount(e.split.percents?.[id]) || 0;
          perHead[id] = totalPct > 0 ? (amt * p) / totalPct : 0;
        });
      } else if (e.split?.mode === "exact") {
        involved.forEach((id) => (perHead[id] = parseAmount(e.split.exact?.[id]) || 0));
        // Si la suma exacta no coincide, reescala proporcionalmente
        const sumExact = Object.values(perHead).reduce((a, b) => a + b, 0);
        if (sumExact > 0 && Math.abs(sumExact - amt) > 0.01) {
          const factor = amt / sumExact;
          Object.keys(perHead).forEach((k) => (perHead[k] *= factor));
        }
      } else {
        const share = amt / involved.length;
        involved.forEach((id) => (perHead[id] = share));
      }

      // El pagador paga, los involucrados deben
      if (e.payerId) bal[e.payerId] += amt;
      involved.forEach((id) => (bal[id] -= perHead[id]));
    });

    // Totales
    const totals = {
      paidBy: Object.fromEntries(participants.map((p) => [p.id, 0])),
      owedBy: Object.fromEntries(participants.map((p) => [p.id, 0])),
    };
    expenses.forEach((e) => {
      const amt = parseAmount(e.amount);
      if (!amt || amt <= 0) return;
      if (e.payerId) totals.paidBy[e.payerId] += amt;
      const involved = e.involvedIds || [];
      if (e.split?.mode === "equal") {
        const share = amt / involved.length;
        involved.forEach((id) => (totals.owedBy[id] += share));
      } else if (e.split?.mode === "shares") {
        const totalShares = involved.reduce((acc, id) => acc + (parseAmount(e.split.shares?.[id]) || 0), 0);
        involved.forEach((id) => {
          const s = parseAmount(e.split.shares?.[id]) || 0;
          totals.owedBy[id] += totalShares > 0 ? (amt * s) / totalShares : 0;
        });
      } else if (e.split?.mode === "percent") {
        const totalPct = involved.reduce((acc, id) => acc + (parseAmount(e.split.percents?.[id]) || 0), 0);
        involved.forEach((id) => {
          const p = parseAmount(e.split.percents?.[id]) || 0;
          totals.owedBy[id] += totalPct > 0 ? (amt * p) / totalPct : 0;
        });
      } else if (e.split?.mode === "exact") {
        involved.forEach((id) => (totals.owedBy[id] += parseAmount(e.split.exact?.[id]) || 0));
      }
    });

    return { balances: bal, totals };
  }, [participants, expenses]);

  const settlements = useMemo(() => computeSettlements(balances), [balances]);

  const nameById = (id) => participants.find((p) => p.id === id)?.name || "(?)";

  const shareURL = () => {
    const payload = { currency, participants, expenses };
    const hash = encodeStateForURL(payload);
    const url = window.location.origin + window.location.pathname + hash;
    navigator.clipboard?.writeText(url);
    alert("Link copiado al portapapeles. Compartilo con tu grupo ✨");
  };

  const exportJSON = () => {
    const payload = { currency, participants, expenses };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "tripsplit.json";
    a.click();
  };

  const importJSON = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (data.participants && data.expenses) {
          setCurrency(data.currency ?? "$");
          setParticipants(data.participants);
          setExpenses(data.expenses);
        } else alert("Archivo inválido");
      } catch (e) {
        alert("No se pudo leer el archivo");
      }
    };
    reader.readAsText(file);
  };

  const [importing, setImporting] = useState(false);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="sticky top-0 z-10 backdrop-blur bg-white/70 border-b">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="text-2xl font-black tracking-tight">TripSplit</div>
          <Chip>Divisor de gastos</Chip>
          <div className="ml-auto flex gap-2">
            <button onClick={shareURL} className="px-3 py-2 rounded-lg border hover:bg-gray-100">Compartir link</button>
            <button onClick={exportJSON} className="px-3 py-2 rounded-lg border hover:bg-gray-100">Exportar JSON</button>
            <label className="px-3 py-2 rounded-lg border hover:bg-gray-100 cursor-pointer">
              Importar
              <input type="file" className="hidden" accept="application/json" onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importJSON(f);
              }} />
            </label>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        <Section title="Moneda & Personas" right={
          <div className="flex items-end gap-2">
            <Input label="Símbolo de moneda" value={currency} onChange={(e) => setCurrency(e.target.value)} style={{width:80}} />
            <Input label="Nuevo participante" placeholder="Nombre" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <button className="px-3 py-2 rounded-lg bg-black text-white" onClick={() => { addParticipant(newName); setNewName(""); }}>Agregar</button>
          </div>
        }>
          <div className="flex flex-wrap gap-3">
            {participants.map((p) => (
              <div key={p.id} className="flex items-center gap-2 border rounded-xl px-3 py-2 bg-white">
                <span className="font-medium">{p.name}</span>
                <button className="text-red-500 hover:underline" onClick={() => removeParticipant(p.id)}>quitar</button>
              </div>
            ))}
            {participants.length === 0 && <div className="text-gray-500">Agregá participantes para empezar</div>}
          </div>
        </Section>

        <Section title="Nuevo gasto">
          <div className="grid md:grid-cols-6 gap-3">
            <Input label="Descripción" placeholder="Ej: Cena, Nafta, Hotel" value={draft.desc} onChange={(e) => setDraft({ ...draft, desc: e.target.value })} className="md:col-span-2" />
            <Input label="Monto" placeholder="0,00" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
            <Input label="Fecha" type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
            <Select label="Pagó" value={draft.payerId || ''} onChange={(e) => setDraft({ ...draft, payerId: e.target.value })}>
              <option value='' disabled>Seleccioná</option>
              {participants.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
            <Select label="Modo de división" value={draft.split?.mode} onChange={(e) => setDraft({ ...draft, split: { mode: e.target.value } })}>
              <option value="equal">Partes iguales</option>
              <option value="shares">Por ponderaciones</option>
              <option value="percent">Por porcentaje</option>
              <option value="exact">Montos exactos</option>
            </Select>
          </div>

          <div className="mt-4">
            <div className="text-sm text-gray-600 mb-2">¿Quiénes participan de este gasto?</div>
            <div className="flex flex-wrap gap-2">
              {participants.map((p) => {
                const checked = draft.involvedIds.includes(p.id);
                return (
                  <label key={p.id} className={`cursor-pointer select-none border rounded-xl px-3 py-2 ${checked ? "bg-black text-white" : "bg-white"}`}>
                    <input type="checkbox" className="hidden" checked={checked} onChange={(e) => {
                      const set = new Set(draft.involvedIds);
                      if (e.target.checked) set.add(p.id); else set.delete(p.id);
                      const involvedIds = Array.from(set);
                      const split = sanitizeSplitForParticipants(draft.split, involvedIds);
                      setDraft({ ...draft, involvedIds, split });
                    }} />
                    {p.name}
                  </label>
                );
              })}
            </div>
          </div>

          {draft.split?.mode !== "equal" && (
            <div className="mt-4 p-3 border rounded-xl bg-gray-50">
              {draft.split?.mode === "shares" && (
                <div>
                  <div className="text-sm text-gray-600 mb-2">Asigná ponderaciones (ej.: 1, 2, 3). Se divide proporcionalmente.</div>
                  <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2">
                    {draft.involvedIds.map((id) => (
                      <Input key={id} label={nameById(id)} placeholder="1" value={draft.split.shares?.[id] ?? ''} onChange={(e) => setDraft({ ...draft, split: { ...draft.split, shares: { ...(draft.split.shares || {}), [id]: e.target.value } } })} />
                    ))}
                  </div>
                </div>
              )}
              {draft.split?.mode === "percent" && (
                <div>
                  <div className="text-sm text-gray-600 mb-2">Porcentaje por persona (suma recomendable: 100).</div>
                  <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2">
                    {draft.involvedIds.map((id) => (
                      <Input key={id} label={nameById(id)} placeholder="%" value={draft.split.percents?.[id] ?? ''} onChange={(e) => setDraft({ ...draft, split: { ...draft.split, percents: { ...(draft.split.percents || {}), [id]: e.target.value } } })} />
                    ))}
                  </div>
                </div>
              )}
              {draft.split?.mode === "exact" && (
                <div>
                  <div className="text-sm text-gray-600 mb-2">Monto exacto por persona (se ajusta si no suma igual al total).</div>
                  <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2">
                    {draft.involvedIds.map((id) => (
                      <Input key={id} label={nameById(id)} placeholder={`${currency} 0,00`} value={draft.split.exact?.[id] ?? ''} onChange={(e) => setDraft({ ...draft, split: { ...draft.split, exact: { ...(draft.split.exact || {}), [id]: e.target.value } } })} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="mt-4 flex gap-2">
            <button className="px-4 py-2 rounded-xl bg-black text-white" onClick={addExpense}>Agregar gasto</button>
            <button className="px-4 py-2 rounded-xl border" onClick={() => setDraft(emptyExpense())}>Limpiar</button>
          </div>
        </Section>

        <Section title="Gastos cargados">
          {expenses.length === 0 ? (
            <div className="text-gray-500">Todavía no hay gastos. Cargá el primero arriba ☝️</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2 pr-2">Fecha</th>
                    <th className="py-2 pr-2">Descripción</th>
                    <th className="py-2 pr-2">Pagó</th>
                    <th className="py-2 pr-2">Incluye</th>
                    <th className="py-2 pr-2">División</th>
                    <th className="py-2 pr-2 text-right">Monto</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((e) => (
                    <tr key={e.id} className="border-b hover:bg-gray-50">
                      <td className="py-2 pr-2 whitespace-nowrap">{e.date}</td>
                      <td className="py-2 pr-2">{e.desc || <span className="text-gray-400">(sin nota)</span>}</td>
                      <td className="py-2 pr-2">{nameById(e.payerId)}</td>
                      <td className="py-2 pr-2">{e.involvedIds.map(nameById).join(", ")}</td>
                      <td className="py-2 pr-2">
                        {e.split?.mode === "equal" && "= iguales"}
                        {e.split?.mode === "shares" && "∝ ponderaciones"}
                        {e.split?.mode === "percent" && "% porcentajes"}
                        {e.split?.mode === "exact" && "= exactos"}
                      </td>
                      <td className="py-2 pr-2 text-right font-medium">{currency} {formatAmount(e.amount)}</td>
                      <td className="py-2 pl-2 text-right"><button className="text-red-500 hover:underline" onClick={() => removeExpense(e.id)}>eliminar</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section title="Saldos por persona">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {participants.map((p) => {
              const net = balances[p.id] || 0;
              const paid = totals.paidBy?.[p.id] || 0;
              const owed = totals.owedBy?.[p.id] || 0;
              return (
                <div key={p.id} className="border rounded-xl p-4 bg-white">
                  <div className="text-base font-semibold mb-1">{p.name}</div>
                  <div className="text-sm text-gray-600">Pagó: <b>{currency} {formatAmount(paid)}</b></div>
                  <div className="text-sm text-gray-600">Le corresponde: <b>{currency} {formatAmount(owed)}</b></div>
                  <div className={`mt-2 text-lg font-bold ${net>=0?"text-green-700":"text-red-700"}`}>
                    {net>=0?"A favor":"En contra"}: {currency} {formatAmount(Math.abs(net))}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>

        <Section title="Transferencias sugeridas (para saldar)">
          {settlements.length === 0 ? (
            <div className="text-gray-500">No hay transferencias pendientes 🎉</div>
          ) : (
            <ul className="space-y-2">
              {settlements.map((t, i) => (
                <li key={i} className="border rounded-xl p-3 bg-white flex items-center justify-between">
                  <div><b>{nameById(t.from)}</b> → <b>{nameById(t.to)}</b></div>
                  <div className="text-right font-semibold">{currency} {formatAmount(t.amount)}</div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <footer className="text-center text-xs text-gray-500 mt-10">
          Hecho con ❤️ para dividir gastos de viaje. Todo queda en tu dispositivo y en el link que compartas.
        </footer>
      </main>
    </div>
  );
}
