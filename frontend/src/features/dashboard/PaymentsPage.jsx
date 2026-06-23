import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { useTenant } from "../../context/TenantContext.jsx";
import { getPaymentOverview, recordTransactionPayment, refundTransactionPayment, updatePaymentSettings } from "../../services/paymentApi.js";
import { capitalize } from "../../utils/transaction.js";

const defaultSettings = {
  codEnabled: true,
  manualEnabled: true,
  jazzCashEnabled: false,
  easyPaisaEnabled: false,
  jazzCashNumber: "",
  easyPaisaNumber: "",
  bankAccountTitle: "",
  bankAccountNumber: "",
  defaultMethod: "cod",
  customerInstructions: "",
};

const methodOptions = [
  { value: "cod", label: "Cash on Delivery" },
  { value: "manual", label: "Manual" },
  { value: "jazzcash", label: "JazzCash" },
  { value: "easypaisa", label: "EasyPaisa" },
  { value: "bank_transfer", label: "Bank transfer" },
];

export function PaymentsPage() {
  const { selectedTenant } = useTenant();
  const [settings, setSettings] = useState(defaultSettings);
  const [records, setRecords] = useState([]);
  const [outstanding, setOutstanding] = useState([]);
  const [summary, setSummary] = useState({});
  const [drafts, setDrafts] = useState({});
  const [refundDrafts, setRefundDrafts] = useState({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingPaymentId, setSavingPaymentId] = useState("");

  useEffect(() => {
    if (selectedTenant?.id) {
      refreshOverview();
    }
  }, [selectedTenant?.id]);

  async function refreshOverview() {
    if (!selectedTenant?.id) return;
    setIsLoading(true);
    setError("");
    try {
      const result = await getPaymentOverview(selectedTenant.id, { page: 1, limit: 30 });
      const data = result.data || {};
      setSettings({ ...defaultSettings, ...(data.settings || {}) });
      setRecords(data.records || []);
      setOutstanding(data.outstandingTransactions || []);
      setSummary(data.summary || {});
      setDrafts((current) => {
        const next = { ...current };
        (data.outstandingTransactions || []).forEach((transaction) => {
          const balance = transaction.paymentSummary?.balance ?? transaction.pricing?.total ?? 0;
          next[transaction.id] = next[transaction.id] || {
            amount: balance,
            method: data.settings?.defaultMethod || "cod",
            status: "completed",
            referenceNumber: "",
            notes: "",
          };
        });
        return next;
      });
      setRefundDrafts((current) => {
        const next = { ...current };
        (data.records || []).forEach((record) => {
          if (record.recordType === "payment" && record.status === "completed") {
            next[record.transactionId] = next[record.transactionId] || {
              amount: record.amount,
              method: record.method || "manual",
              referenceNumber: "",
              notes: "",
            };
          }
        });
        return next;
      });
    } catch (requestError) {
      setError(requestError.response?.data?.detail || "Unable to load payment overview.");
    } finally {
      setIsLoading(false);
    }
  }

  function updateSetting(key, value) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  function updateDraft(transactionId, key, value) {
    setDrafts((current) => ({
      ...current,
      [transactionId]: { ...(current[transactionId] || {}), [key]: value },
    }));
  }

  function updateRefundDraft(transactionId, key, value) {
    setRefundDrafts((current) => ({
      ...current,
      [transactionId]: { ...(current[transactionId] || {}), [key]: value },
    }));
  }

  async function saveSettings(event) {
    event.preventDefault();
    setSavingSettings(true);
    setMessage("");
    setError("");
    try {
      const updated = await updatePaymentSettings(selectedTenant.id, settings);
      setSettings({ ...defaultSettings, ...updated });
      setMessage("Payment settings saved.");
      await refreshOverview();
    } catch (requestError) {
      setError(requestError.response?.data?.detail || "Unable to save payment settings.");
    } finally {
      setSavingSettings(false);
    }
  }

  async function submitPayment(transactionId) {
    const draft = drafts[transactionId];
    if (!draft) return;
    setSavingPaymentId(transactionId);
    setMessage("");
    setError("");
    try {
      await recordTransactionPayment(selectedTenant.id, transactionId, {
        ...draft,
        amount: Number(draft.amount || 0),
      });
      setMessage("Payment recorded.");
      await refreshOverview();
    } catch (requestError) {
      setError(requestError.response?.data?.detail || "Unable to record payment.");
    } finally {
      setSavingPaymentId("");
    }
  }

  async function submitRefund(transactionId) {
    const draft = refundDrafts[transactionId];
    if (!draft) return;
    setSavingPaymentId(`refund-${transactionId}`);
    setMessage("");
    setError("");
    try {
      await refundTransactionPayment(selectedTenant.id, transactionId, {
        ...draft,
        amount: Number(draft.amount || 0),
      });
      setMessage("Refund recorded.");
      await refreshOverview();
    } catch (requestError) {
      setError(requestError.response?.data?.detail || "Unable to record refund.");
    } finally {
      setSavingPaymentId("");
    }
  }

  if (!selectedTenant) {
    return (
      <section className="space-y-4">
        <h1 className="text-3xl font-semibold text-ink">Payments</h1>
        <p className="text-sm text-muted">Create a business before configuring payments.</p>
        <Link className="inline-flex rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white" to="/dashboard/business">
          Create Business
        </Link>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="border-b border-line pb-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-brand">Phase 25</p>
        <h1 className="mt-2 text-3xl font-semibold text-ink">Payments</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">
          Configure COD, manual, JazzCash, EasyPaisa, and bank transfer instructions. Record verified payments and refunds against orders.
        </p>
      </div>

      {message ? <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{message}</div> : null}
      {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Received" value={formatMoney(summary.received || 0)} />
        <StatCard label="Refunded" value={formatMoney(summary.refunded || 0)} />
        <StatCard label="Net received" value={formatMoney(summary.netReceived || 0)} />
        <StatCard label="Outstanding" value={summary.outstandingTransactions || 0} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <form className="space-y-4 rounded-md border border-line bg-white p-5 shadow-sm" onSubmit={saveSettings}>
          <div>
            <h2 className="text-lg font-semibold text-ink">Payment Settings</h2>
            <p className="mt-1 text-sm text-muted">These settings are used by the order workflow and customer-facing payment instructions. COD/manual work without wallet numbers. JazzCash/EasyPaisa numbers are needed only when those wallet methods are enabled.</p>
            <div className="mt-3 rounded-md border border-blue-100 bg-blue-50 p-3 text-xs leading-5 text-blue-800">
              Demo note: this phase records and verifies payments inside BizXusAI. It does not move real money unless you later connect real gateway credentials.
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Toggle label="COD" checked={settings.codEnabled} onChange={(value) => updateSetting("codEnabled", value)} />
            <Toggle label="Manual verification" checked={settings.manualEnabled} onChange={(value) => updateSetting("manualEnabled", value)} />
            <Toggle label="JazzCash" checked={settings.jazzCashEnabled} onChange={(value) => updateSetting("jazzCashEnabled", value)} />
            <Toggle label="EasyPaisa" checked={settings.easyPaisaEnabled} onChange={(value) => updateSetting("easyPaisaEnabled", value)} />
          </div>
          <Field label="Default Method">
            <select className="form-input" value={settings.defaultMethod || "cod"} onChange={(event) => updateSetting("defaultMethod", event.target.value)}>
              {methodOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            {settings.jazzCashEnabled ? (
              <Field label="JazzCash Number">
                <input className="form-input" value={settings.jazzCashNumber || ""} onChange={(event) => updateSetting("jazzCashNumber", event.target.value)} placeholder="03XXXXXXXXX" />
              </Field>
            ) : null}
            {settings.easyPaisaEnabled ? (
              <Field label="EasyPaisa Number">
                <input className="form-input" value={settings.easyPaisaNumber || ""} onChange={(event) => updateSetting("easyPaisaNumber", event.target.value)} placeholder="03XXXXXXXXX" />
              </Field>
            ) : null}
            <Field label="Bank Account Title">
              <input className="form-input" value={settings.bankAccountTitle || ""} onChange={(event) => updateSetting("bankAccountTitle", event.target.value)} placeholder="Only for bank/manual transfer" />
            </Field>
            <Field label="Bank Account Number">
              <input className="form-input" value={settings.bankAccountNumber || ""} onChange={(event) => updateSetting("bankAccountNumber", event.target.value)} placeholder="Optional" />
            </Field>
          </div>
          <Field label="Customer Payment Instructions">
            <textarea className="form-input min-h-28" value={settings.customerInstructions || ""} onChange={(event) => updateSetting("customerInstructions", event.target.value)} />
          </Field>
          <button className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" disabled={savingSettings}>
            {savingSettings ? "Saving..." : "Save Payment Settings"}
          </button>
        </form>

        <div className="space-y-4 rounded-md border border-line bg-white p-5 shadow-sm">
          <div>
            <h2 className="text-lg font-semibold text-ink">Outstanding Transactions</h2>
            <p className="mt-1 text-sm text-muted">Record COD or verified manual/local wallet payments after the owner confirms them.</p>
          </div>
          {isLoading ? <div className="text-sm text-muted">Loading payments...</div> : null}
          <div className="space-y-3">
            {outstanding.map((transaction) => {
              const draft = drafts[transaction.id] || {};
              const balance = transaction.paymentSummary?.balance ?? transaction.pricing?.total ?? 0;
              return (
                <div key={transaction.id} className="rounded-md border border-line bg-surface p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="font-semibold text-ink">{transaction.transactionNumber}</div>
                      <div className="mt-1 text-xs text-muted">{transaction.customerSnapshot?.name || "Guest"} / {transaction.customerSnapshot?.phone || "No phone"}</div>
                    </div>
                    <div className="text-sm font-semibold text-ink">Balance: {formatMoney(balance)}</div>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <Field label="Amount">
                      <input className="form-input" type="number" min="1" value={draft.amount ?? balance} onChange={(event) => updateDraft(transaction.id, "amount", event.target.value)} />
                    </Field>
                    <Field label="Method">
                      <select className="form-input" value={draft.method || settings.defaultMethod || "cod"} onChange={(event) => updateDraft(transaction.id, "method", event.target.value)}>
                        {methodOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </Field>
                    <Field label="Record Status">
                      <select className="form-input" value={draft.status || "completed"} onChange={(event) => updateDraft(transaction.id, "status", event.target.value)}>
                        <option value="completed">Completed / verified</option>
                        <option value="pending">Pending proof</option>
                        <option value="failed">Failed</option>
                      </select>
                    </Field>
                    <Field label="Reference Number">
                      <input className="form-input" value={draft.referenceNumber || ""} onChange={(event) => updateDraft(transaction.id, "referenceNumber", event.target.value)} />
                    </Field>
                    <div className="md:col-span-2">
                      <Field label="Notes">
                        <textarea className="form-input min-h-20" value={draft.notes || ""} onChange={(event) => updateDraft(transaction.id, "notes", event.target.value)} />
                      </Field>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="mt-3 rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    disabled={savingPaymentId === transaction.id}
                    onClick={() => submitPayment(transaction.id)}
                  >
                    {savingPaymentId === transaction.id ? "Recording..." : "Record Payment"}
                  </button>
                </div>
              );
            })}
            {!outstanding.length && !isLoading ? <div className="rounded-md border border-dashed border-line p-4 text-sm text-muted">No outstanding payment transactions.</div> : null}
          </div>
        </div>
      </div>

      <div className="rounded-md border border-line bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-ink">Recent Payment Records</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full divide-y divide-line text-sm">
            <thead className="bg-surface text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2">Transaction</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Method</th>
                <th className="px-3 py-2">Amount</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Refund</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {records.map((record) => {
                const refundDraft = refundDrafts[record.transactionId] || {};
                return (
                  <tr key={record.id}>
                    <td className="px-3 py-3 font-semibold text-ink">{record.transactionNumber}</td>
                    <td className="px-3 py-3 text-muted">{record.customerSnapshot?.name || "Guest"}</td>
                    <td className="px-3 py-3 capitalize text-muted">{record.recordType}</td>
                    <td className="px-3 py-3 capitalize text-muted">{String(record.method || "").replaceAll("_", " ")}</td>
                    <td className="px-3 py-3 text-muted">{formatMoney(record.amount)}</td>
                    <td className="px-3 py-3 capitalize text-muted">{record.status}</td>
                    <td className="px-3 py-3">
                      {record.recordType === "payment" && record.status === "completed" ? (
                        <div className="flex flex-col gap-2 min-w-52">
                          <input className="form-input" type="number" min="1" value={refundDraft.amount ?? record.amount} onChange={(event) => updateRefundDraft(record.transactionId, "amount", event.target.value)} />
                          <input className="form-input" placeholder="Refund reference" value={refundDraft.referenceNumber || ""} onChange={(event) => updateRefundDraft(record.transactionId, "referenceNumber", event.target.value)} />
                          <button className="rounded-md border border-line px-3 py-2 text-xs font-semibold text-ink" disabled={savingPaymentId === `refund-${record.transactionId}`} onClick={() => submitRefund(record.transactionId)}>
                            {savingPaymentId === `refund-${record.transactionId}` ? "Saving..." : "Record Refund"}
                          </button>
                        </div>
                      ) : <span className="text-xs text-muted">—</span>}
                    </td>
                  </tr>
                );
              })}
              {!records.length ? (
                <tr>
                  <td className="px-3 py-5 text-sm text-muted" colSpan="7">No payment records yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="rounded-md border border-line bg-white p-4 shadow-sm">
      <div className="text-sm text-muted">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-ink">{value}</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block space-y-2 text-sm font-medium text-ink">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="flex items-center justify-between rounded-md border border-line px-3 py-2 text-sm text-ink">
      <span>{label}</span>
      <input type="checkbox" checked={Boolean(checked)} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function formatMoney(value) {
  const number = Number(value || 0);
  return `PKR ${number.toLocaleString()}`;
}
