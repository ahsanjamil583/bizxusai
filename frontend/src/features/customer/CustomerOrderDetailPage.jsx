import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { getCustomerTransaction, reorderCustomerTransaction } from "../../services/customerPortalApi.js";
import { capitalize, formatTransactionType } from "../../utils/transaction.js";

export function CustomerOrderDetailPage() {
  const { orderId } = useParams();
  const [order, setOrder] = useState(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    getCustomerTransaction(orderId).then(setOrder);
  }, [orderId]);

  if (!order) return <section className="text-sm text-muted">Loading transaction...</section>;

  return (
    <section className="space-y-6">
      <div className="border-b border-line pb-6">
        <Link className="text-sm font-semibold text-brand" to="/customer/orders">Back to orders</Link>
        <p className="mt-4 text-sm font-semibold uppercase tracking-wide text-brand">Transaction Detail</p>
        <h1 className="mt-2 text-3xl font-semibold text-ink">{order.transactionNumber}</h1>
        <button
          type="button"
          className="mt-4 rounded-md border border-line px-4 py-2 text-sm font-semibold text-ink"
          onClick={async () => {
            const result = await reorderCustomerTransaction(order.id);
            setMessage(`Items were added back to your cart for ${result.tenantSlug}.`);
          }}
        >
          Reorder these items
        </button>
      </div>
      {message ? <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{message}</div> : null}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="rounded-md border border-line bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-ink">Items</h2>
          <div className="mt-4 space-y-3">
            {order.items.map((item) => (
              <div key={`${order.id}-${item.itemId}`} className="flex items-center justify-between rounded-md border border-line p-4">
                <div>
                  <div className="font-semibold text-ink">{item.name}</div>
                  <div className="text-sm text-muted">Qty: {item.quantity}</div>
                </div>
                <div className="text-sm font-semibold text-ink">{item.subtotal}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-md border border-line bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-ink">Summary</h2>
          <div className="mt-4 space-y-3 text-sm">
            <InfoRow label="Type" value={capitalize(formatTransactionType(order.transactionType))} />
            <InfoRow label="Status" value={order.status} />
            <InfoRow label="Payment" value={order.paymentStatus} />
            <InfoRow label="Source" value={order.source} />
            <InfoRow label="Total" value={order.pricing?.total} />
          </div>
        </div>
      </div>
    </section>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="flex items-center justify-between border-b border-line pb-3 last:border-b-0 last:pb-0">
      <span className="text-muted">{label}</span>
      <span className="font-semibold capitalize text-ink">{value}</span>
    </div>
  );
}
