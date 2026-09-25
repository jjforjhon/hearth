import { useEffect, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { useSession } from "../lib/session";

interface Batch {
  id: string;
  weekKey: string;
  provider: string;
  status: string;
  requested: number;
  accepted: number;
  rejected: number;
  duplicates: number;
  safetyRejected: number;
  error: string | null;
  createdAt: string;
  publishedAt: string | null;
}

interface PoolStat {
  kind: string;
  published: number;
  active: number;
}

interface ContentItem {
  id: string;
  kind: string;
  category: string;
  difficulty: number;
  body: string | null;
  status: string;
  published: number;
  batchId: string | null;
}

interface ReportRow {
  id: string;
  reporter_id: string;
  target_type: string;
  target_id: string;
  reason: string;
  details: string;
  status: string;
  created_at: number;
  reporter_username: string | null;
}

export function Admin(): ReactNode {
  const { user } = useSession();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [pool, setPool] = useState<PoolStat[]>([]);
  const [items, setItems] = useState<ContentItem[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"content" | "reports">("content");
  const [search, setSearch] = useState("");

  const load = (): void => {
    api
      .get<{ batches: Batch[]; pool: PoolStat[] }>("/api/admin/batches")
      .then((d) => {
        setBatches(d.batches);
        setPool(d.pool);
      })
      .catch((e) => setError(e.message));
    api
      .get<{ items: ContentItem[] }>("/api/admin/content?limit=60")
      .then((d) => setItems(d.items))
      .catch(() => {});
    api
      .get<{ reports: ReportRow[] }>("/api/admin/reports")
      .then((d) => setReports(d.reports))
      .catch(() => {});
  };

  useEffect(() => {
    if (user?.isPlatformAdmin) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.isPlatformAdmin]);

  if (!user?.isPlatformAdmin) {
    return (
      <div className="page">
        <div className="empty">
          <div className="empty-icon" aria-hidden>
            ⚠
          </div>
          <h3>Admins only</h3>
          <p>This area is restricted to platform administrators.</p>
        </div>
      </div>
    );
  }

  const disableItem = async (id: string): Promise<void> => {
    await api.post(`/api/admin/content/${id}/disable`);
    load();
  };

  const enableItem = async (id: string): Promise<void> => {
    await api.post(`/api/admin/content/${id}/enable`);
    load();
  };

  const rollback = async (id: string): Promise<void> => {
    await api.post(`/api/admin/batches/${id}/rollback`);
    load();
  };

  const regenerate = async (id: string): Promise<void> => {
    await api.post(`/api/admin/batches/${id}/regenerate`);
    window.setTimeout(load, 1500);
  };

  const resolveReport = async (id: string, action: "resolve" | "dismiss"): Promise<void> => {
    await api.post(`/api/admin/reports/${id}/resolve`, { action });
    load();
  };

  const filteredItems = search
    ? items.filter((i) => i.body?.toLowerCase().includes(search.toLowerCase()))
    : items;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Admin</h1>
        <p>Content pipeline, moderation queue and audit trail.</p>
      </div>

      {error && (
        <p className="field-error mb-4" role="alert">
          {error}
        </p>
      )}

      <div className="row mb-4" style={{ gap: "var(--sp-2)" }}>
        <button className={`btn btn-sm ${tab === "content" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("content")}>
          Content pipeline
        </button>
        <button className={`btn btn-sm ${tab === "reports" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("reports")}>
          Reports ({reports.filter((r) => r.status === "open").length})
        </button>
      </div>

      {tab === "content" && (
        <>
          <div className="card mb-4">
            <h3 className="mb-4">Live pools</h3>
            <div className="row row-wrap">
              {pool.map((p) => (
                <span key={p.kind} className="badge">
                  {p.kind}: {p.published} live / {p.active} total
                </span>
              ))}
            </div>
          </div>

          <div className="card mb-4">
            <h3 className="mb-4">Weekly batches</h3>
            {batches.length === 0 ? (
              <p className="muted small">No batches yet.</p>
            ) : (
              <div className="stack">
                {batches.map((b) => (
                  <div key={b.id} className="row row-wrap" style={{ justifyContent: "space-between", gap: "var(--sp-3)" }}>
                    <div>
                      <strong>{b.weekKey}</strong>{" "}
                      <span className={`badge ${b.status === "published" ? "badge-good" : b.status === "failed" ? "badge-alert" : ""}`}>
                        {b.status}
                      </span>{" "}
                      <span className="faint small">
                        {b.accepted}/{b.requested} accepted · {b.duplicates} dups · {b.safetyRejected} blocked
                        {b.error ? ` · ${b.error}` : ""}
                      </span>
                    </div>
                    <div className="row">
                      {b.status === "published" && (
                        <button className="btn btn-ghost btn-sm" onClick={() => void rollback(b.id)}>
                          Roll back to this
                        </button>
                      )}
                      {(b.status === "failed" || b.status === "ready") && (
                        <button className="btn btn-secondary btn-sm" onClick={() => void regenerate(b.id)}>
                          Regenerate
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <div className="row mb-4" style={{ justifyContent: "space-between" }}>
              <h3>Content items</h3>
              <input
                className="input"
                placeholder="Search…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ maxWidth: 220 }}
                aria-label="Search content"
              />
            </div>
            <div className="stack">
              {filteredItems.slice(0, 40).map((i) => (
                <div key={i.id} className="row" style={{ justifyContent: "space-between", gap: "var(--sp-3)" }}>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span className="badge" style={{ marginRight: 8 }}>
                      {i.kind}
                    </span>
                    {i.body ?? "(choice pair)"}
                    <span className="faint small"> · {i.category} · T{i.difficulty}</span>
                  </span>
                  <span className="row" style={{ flexShrink: 0 }}>
                    <span className={`badge ${i.status === "active" ? "badge-good" : "badge-alert"}`}>{i.status}</span>
                    {i.status === "active" ? (
                      <button className="btn btn-ghost btn-sm" onClick={() => void disableItem(i.id)}>
                        Disable
                      </button>
                    ) : (
                      <button className="btn btn-ghost btn-sm" onClick={() => void enableItem(i.id)}>
                        Restore
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {tab === "reports" && (
        <div className="card">
          <h3 className="mb-4">Reports</h3>
          {reports.length === 0 ? (
            <p className="muted small">No reports — a quiet room is a happy room.</p>
          ) : (
            <div className="stack">
              {reports.map((r) => (
                <div key={r.id} className="row row-wrap" style={{ justifyContent: "space-between", gap: "var(--sp-3)" }}>
                  <span>
                    <span className={`badge ${r.status === "open" ? "badge-alert" : ""}`}>{r.status}</span>{" "}
                    <strong>{r.reason}</strong> on {r.target_type}{" "}
                    <span className="faint small">
                      by @{r.reporter_username ?? "unknown"} · {new Date(r.created_at).toLocaleString()}
                    </span>
                    {r.details && <div className="faint small">{r.details}</div>}
                  </span>
                  {r.status === "open" && (
                    <span className="row">
                      <button className="btn btn-secondary btn-sm" onClick={() => void resolveReport(r.id, "resolve")}>
                        Resolve
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => void resolveReport(r.id, "dismiss")}>
                        Dismiss
                      </button>
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
