import { useEffect, useState } from "react";

import { getAdminTenants, updateAdminTenant } from "../../services/adminApi.js";
import { getAdminBusinessCategories } from "../../services/businessCategoryApi.js";

export function AdminTenantsPage() {
  const [tenants, setTenants] = useState([]);
  const [categories, setCategories] = useState([]);
  const [busyTenant, setBusyTenant] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    refreshPage();
  }, []);

  async function refreshPage() {
    setIsLoading(true);
    try {
      const [tenantRows, categoryRows] = await Promise.all([getAdminTenants(), getAdminBusinessCategories()]);
      setTenants(tenantRows);
      setCategories(categoryRows);
      setError("");
    } catch (requestError) {
      setError(requestError.response?.data?.detail || "Unable to load tenants.");
    } finally {
      setIsLoading(false);
    }
  }

  async function saveTenant(tenant, patch) {
    setBusyTenant(tenant.id);
    setError("");
    setMessage("");
    try {
      const updated = await updateAdminTenant(tenant.id, patch);
      setTenants((current) => current.map((item) => (item.id === tenant.id ? updated : item)));
      setMessage(`Updated ${updated.name}.`);
    } catch (requestError) {
      setError(requestError.response?.data?.detail || "Unable to update tenant.");
    } finally {
      setBusyTenant("");
    }
  }

  return (
    <section className="space-y-6">
      <div className="border-b border-line pb-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-brand">SaaS Management</p>
        <h1 className="mt-2 text-3xl font-semibold text-ink">Tenants</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
          Manage tenant status, public visibility, website publication, category assignment, and subscription plan restrictions from one place.
        </p>
      </div>

      {message ? <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{message}</div> : null}
      {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
      {isLoading ? <div className="text-sm text-muted">Loading tenants...</div> : null}

      <div className="space-y-4">
        {tenants.map((tenant) => (
          <article key={tenant.id} className="rounded-md border border-line bg-white p-5 shadow-sm">
            <div className="grid gap-4 xl:grid-cols-[1.6fr_repeat(4,minmax(0,1fr))]">
              <div>
                <div className="text-lg font-semibold text-ink">{tenant.name}</div>
                <div className="mt-1 text-sm text-muted">{tenant.slug}</div>
                <div className="mt-2 text-sm text-muted">Owner: {tenant.owner?.fullName || "Unknown"}</div>
                <div className="mt-1 text-sm text-muted">Modules enabled: {tenant.enabledModuleCount || 0}</div>
              </div>
              <Field label="Tenant status">
                <select className="form-input" value={tenant.status || "draft"} disabled={busyTenant === tenant.id} onChange={(event) => saveTenant(tenant, { status: event.target.value })}>
                  <option value="draft">draft</option>
                  <option value="active">active</option>
                  <option value="archived">archived</option>
                </select>
              </Field>
              <Field label="Website status">
                <select
                  className="form-input"
                  value={tenant.websiteStatus || "not_generated"}
                  disabled={busyTenant === tenant.id}
                  onChange={(event) => saveTenant(tenant, { websiteStatus: event.target.value })}
                >
                  <option value="not_generated">not_generated</option>
                  <option value="published">published</option>
                  <option value="unpublished">unpublished</option>
                </select>
              </Field>
              <Field label="Plan">
                <select
                  className="form-input"
                  value={tenant.settings?.planCode || "starter"}
                  disabled={busyTenant === tenant.id}
                  onChange={(event) =>
                    saveTenant(tenant, {
                      settings: {
                        ...(tenant.settings || {}),
                        planCode: event.target.value,
                      },
                    })
                  }
                >
                  <option value="starter">starter</option>
                  <option value="growth">growth</option>
                  <option value="scale">scale</option>
                </select>
              </Field>
              <Field label="Public visibility">
                <select
                  className="form-input"
                  value={String(tenant.settings?.publicVisibility ?? true)}
                  disabled={busyTenant === tenant.id}
                  onChange={(event) =>
                    saveTenant(tenant, {
                      settings: {
                        ...(tenant.settings || {}),
                        publicVisibility: event.target.value === "true",
                      },
                    })
                  }
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              </Field>
              <Field label="Category">
                <select
                  className="form-input"
                  value={tenant.businessCategoryId || ""}
                  disabled={busyTenant === tenant.id}
                  onChange={(event) => saveTenant(tenant, { businessCategoryId: event.target.value || null })}
                >
                  <option value="">None</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </article>
        ))}
        {!tenants.length && !isLoading ? <div className="rounded-md border border-dashed border-line bg-surface p-6 text-sm text-muted">No tenants found.</div> : null}
      </div>
    </section>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      {children}
    </label>
  );
}
