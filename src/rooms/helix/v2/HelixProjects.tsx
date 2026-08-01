// Single source of truth for HELIX projects (docs/ux/02 §6, audit F5). The shell's project
// switcher AND the Projects surface both read/write THIS — no more two lists drifting apart.
// Owns: list, active project, loading/error, and create/remove/select (with cascade delete
// + honest active-project reconciliation).
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useUI } from "./HxUI";

export interface HProject { id: string; name: string; mode?: string; objective?: string; helix_score?: number }

interface ProjectsCtx {
  projects: HProject[]; active: HProject | null; loading: boolean; error: string | null;
  refresh: () => void;
  select: (p: HProject) => void;
  create: (name: string, mode?: string) => Promise<HProject | null>;
  remove: (id: string) => Promise<boolean>;
}

const Ctx = createContext<ProjectsCtx | null>(null);
export const useProjects = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useProjects must be used inside <HelixProjectsProvider>");
  return c;
};

const LS_KEY = "helix-active-project";

export function HelixProjectsProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<HProject[]>([]);
  const [active, setActive] = useState<HProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useUI();
  // Refs mirror latest state for the optimistic-delete snapshot/rollback.
  const projectsRef = useRef(projects); projectsRef.current = projects;
  const activeRef = useRef(active); activeRef.current = active;

  const refresh = useCallback(() => {
    setLoading(true); setError(null);
    fetch("/api/helix/projects")
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(d => {
        const list: HProject[] = (d?.projects || []).map((p: any) => ({
          id: p.id, name: p.name || "Untitled Project", mode: p.mode, objective: p.objective, helix_score: p.helix_score,
        }));
        setProjects(list);
        setLoading(false);
        // Restore the LAST explicitly-chosen project; else first. Keep current if still present.
        setActive(prev => {
          if (prev) { const still = list.find(p => p.id === prev.id); if (still) return still; }
          const remembered = localStorage.getItem(LS_KEY);
          return list.find(p => p.id === remembered) || list[0] || null;
        });
      })
      .catch(e => { setError(e?.message || "Failed to load projects"); setLoading(false); });
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const select = useCallback((p: HProject) => {
    setActive(p);
    localStorage.setItem(LS_KEY, p.id);
  }, []);

  const create = useCallback(async (name: string, mode = "research") => {
    try {
      const r = await fetch("/api/helix/project/create", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, mode }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.project) {
        const p: HProject = { id: d.project.id, name: d.project.name, mode: d.project.mode };
        setProjects(ps => [p, ...ps]);
        select(p);
        return p;
      }
      return null;
    } catch { return null; }
  }, [select]);

  // Optimistic delete with a grace-period Undo (docs/ux/02 §3): the row disappears
  // instantly, an "Undo" toast shows for 5s, and the (irreversible, cascading) server
  // delete only fires AFTER the window — so Undo is real, not cosmetic. On server failure
  // we roll back to the snapshot.
  const remove = useCallback((id: string) => {
    const snapProjects = projectsRef.current;
    const snapActive = activeRef.current;
    const proj = snapProjects.find(p => p.id === id);
    if (!proj) return Promise.resolve(false);

    setProjects(ps => ps.filter(p => p.id !== id));
    setActive(prev => {
      if (prev?.id !== id) return prev;
      const fb = snapProjects.filter(p => p.id !== id)[0] || null;
      if (fb) localStorage.setItem(LS_KEY, fb.id); else localStorage.removeItem(LS_KEY);
      return fb;
    });

    let undone = false;
    const timer = window.setTimeout(async () => {
      if (undone) return;
      try {
        const r = await fetch(`/api/helix/projects/${encodeURIComponent(id)}`, {
          method: "DELETE", headers: { "Content-Type": "application/json" },
        });
        const d = await r.json().catch(() => ({}));
        if (!(r.ok && d.ok)) { setProjects(snapProjects); setActive(snapActive); toast("Delete failed — restored", "bad"); }
      } catch { setProjects(snapProjects); setActive(snapActive); toast("Delete failed — restored", "bad"); }
    }, 5000);

    toast(`Deleted "${proj.name}"`, "good", {
      duration: 5000,
      action: {
        label: "Undo",
        run: () => {
          undone = true; window.clearTimeout(timer);
          setProjects(snapProjects); setActive(snapActive);
          if (snapActive) localStorage.setItem(LS_KEY, snapActive.id);
          toast("Restored", "info");
        },
      },
    });
    return Promise.resolve(true);
  }, [toast]);

  return (
    <Ctx.Provider value={{ projects, active, loading, error, refresh, select, create, remove }}>
      {children}
    </Ctx.Provider>
  );
}
