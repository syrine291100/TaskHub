"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { request, ApiError, type Session, type User, type Workspace, type Project, type Member, type Board, type Task } from "../lib/api";

const priorities: Record<string, string> = { low: "Basse", medium: "Moyenne", high: "Haute" };
type Editor = { kind: "task"; task?: Task; columnId: number } | { kind: "project"; project?: Project } | { kind: "workspace" } | { kind: "member" };
function localDate() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [register, setRegister] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState<number | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [board, setBoard] = useState<Board | null>(null);
  const [query, setQuery] = useState("");
  const [priority, setPriority] = useState("");
  const [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const lock = useRef(false);
  const token = session?.access_token ?? null;

  const logout = useCallback(() => {
    sessionStorage.removeItem("taskhub.session"); setSession(null); setWorkspaces([]); setWorkspaceId(null); setProjects([]); setProjectId(null); setMembers([]); setBoard(null); setEditor(null);
  }, []);
  const report = useCallback((e: unknown) => {
    if (e instanceof Error && e.name === "AbortError") return;
    if (e instanceof ApiError && e.status === 401) { logout(); setError("Ta session a expiré. Reconnecte-toi."); }
    else setError(e instanceof TypeError ? "Impossible de joindre l’API. Vérifie que le backend est lancé." : e instanceof Error ? e.message : "Une erreur est survenue.");
  }, [logout]);

  useEffect(() => {
    const controller = new AbortController();
    async function restore() {
      try {
        const raw = sessionStorage.getItem("taskhub.session");
        if (raw) { const stored = JSON.parse(raw) as Session; const user = await request<User>("/auth/me", stored.access_token, "GET", undefined, controller.signal); setSession({ ...stored, user }); }
      } catch (e) { if (!(e instanceof Error && e.name === "AbortError")) { sessionStorage.removeItem("taskhub.session"); report(e); } }
      finally { if (!controller.signal.aborted) setReady(true); }
    }
    void restore(); return () => controller.abort();
  }, [report]);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    request<Workspace[]>("/workspaces", token, "GET", undefined, controller.signal).then(data => {
      setWorkspaces(data); setWorkspaceId(current => data.some(w => w.id === current) ? current : data[0]?.id ?? null);
    }).catch(report);
    return () => controller.abort();
  }, [token, revision, report]);

  useEffect(() => {
    if (!token || !workspaceId) return;
    const controller = new AbortController();
    Promise.all([request<Project[]>(`/workspaces/${workspaceId}/projects`, token, "GET", undefined, controller.signal), request<Member[]>(`/workspaces/${workspaceId}/members`, token, "GET", undefined, controller.signal)]).then(([p, m]) => {
      setProjects(p); setMembers(m); setProjectId(current => p.some(x => x.id === current) ? current : p[0]?.id ?? null);
    }).catch(report);
    return () => controller.abort();
  }, [token, workspaceId, revision, report]);

  useEffect(() => {
    if (!token || !projectId) return;
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      setLoading(true);
      try { const params = new URLSearchParams({ q: query }); if (priority) params.set("priority", priority); setBoard(await request<Board>(`/projects/${projectId}/board?${params}`, token, "GET", undefined, controller.signal)); }
      catch (e) { report(e); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, 200);
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [token, projectId, query, priority, revision, report]);

  useEffect(() => { if (editor) dialogRef.current?.showModal(); else dialogRef.current?.close(); }, [editor]);

  async function action(operation: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try { await operation(); } catch (e) { report(e); } finally { lock.current = false; setBusy(false); }
  }
  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = new FormData(event.currentTarget);
    await action(async () => {
      const data = await request<Session>(register ? "/auth/register" : "/auth/login", null, "POST", { email: f.get("email"), password: f.get("password"), ...(register ? { name: f.get("name") } : {}) });
      sessionStorage.setItem("taskhub.session", JSON.stringify(data)); setSession(data);
    });
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = new FormData(event.currentTarget);
    await action(async () => {
      if (editor?.kind === "workspace") {
        const w = await request<Workspace>("/workspaces", token, "POST", { name: f.get("name") }); changeWorkspace(w.id);
      } else if (editor?.kind === "member") {
        await request(`/workspaces/${workspaceId}/members`, token, "POST", { email: f.get("email") });
      } else if (editor?.kind === "project") {
        const p = await request<Project>(editor.project ? `/projects/${editor.project.id}` : `/workspaces/${workspaceId}/projects`, token, editor.project ? "PATCH" : "POST", { name: f.get("name"), description: f.get("description") || null });
        changeProject(p.id);
      } else if (editor?.kind === "task") {
        await request(editor.task ? `/tasks/${editor.task.id}` : `/projects/${projectId}/tasks`, token, editor.task ? "PATCH" : "POST", { title: f.get("title"), description: f.get("description") || null, column_id: Number(f.get("column_id")), priority: f.get("priority"), due_date: f.get("due_date") || null, assignee_id: f.get("assignee_id") ? Number(f.get("assignee_id")) : null });
      }
      setEditor(null); setRevision(r => r + 1); setNotice("Modifications enregistrées.");
    });
  }
  function changeProject(id: number | null) { setProjectId(id); setBoard(null); setQuery(""); setPriority(""); }
  function changeWorkspace(id: number) { setWorkspaceId(id); setProjects([]); setMembers([]); changeProject(null); }
  function open(value: Editor) { setError(""); setNotice(""); setEditor(value); }
  async function moveTask(task: Task, columnId: number) {
    if (task.column_id === columnId) return;
    await action(async () => { await request(`/tasks/${task.id}`, token, "PATCH", { column_id: columnId }); setRevision(r => r + 1); setNotice("Tâche déplacée."); });
  }
  async function deleteTask(task: Task) {
    if (!window.confirm(`Supprimer « ${task.title} » ?`)) return;
    await action(async () => { await request(`/tasks/${task.id}`, token, "DELETE"); setEditor(null); setRevision(r => r + 1); setNotice("Tâche supprimée."); });
  }
  const workspace = workspaces.find(w => w.id === workspaceId);
  const currentBoard = board?.project.id === projectId ? board : null;

  if (!ready) return <main className="boot" aria-busy="true">Chargement de TaskHub…</main>;
  if (!session) return <main className="auth-shell">
    <section className="auth-story"><div className="brand"><span className="brand-icon">▦</span> TaskHub</div><span className="eyebrow">UN PEU DE CLARTÉ, BEAUCOUP D’ÉLAN</span><h1>Vos projets.<br />Le cap en vue.</h1><p>Un espace pour transformer les idées en actions, suivre les priorités et avancer ensemble.</p><div className="mini-board" aria-hidden="true"><div><i />À faire<span>Poser les idées</span></div><div><i />En cours<span>Construire la suite</span></div><div><i />Terminé<span>Fêter le progrès ✓</span></div></div><small>Organiser · Collaborer · Avancer</small></section>
    <section className="auth-form"><div className="form-card"><span className="eyebrow">BIENVENUE DANS VOTRE ESPACE</span><h2>{register ? "On commence ?" : "Bon retour."}</h2><p>{register ? "Crée ton compte et lance ton premier projet." : "Tes projets t’attendent. Reprenons le fil."}</p>{error && <div className="alert" role="alert">{error}</div>}<form onSubmit={authenticate}>{register && <label>Nom<input name="name" autoComplete="name" required maxLength={100} /></label>}<label>Adresse e-mail<input name="email" type="email" autoComplete="email" required /></label><label>Mot de passe<input name="password" type="password" autoComplete={register ? "new-password" : "current-password"} required minLength={register ? 8 : 1} maxLength={128} />{register && <small>Au moins 8 caractères.</small>}</label><button className="primary" disabled={busy}>{busy ? "Un instant…" : register ? "Créer mon compte →" : "Se connecter →"}</button></form><p className="switch-auth">{register ? "Déjà un compte ?" : "Première visite ?"} <button onClick={() => { setRegister(!register); setError(""); }} disabled={busy}>{register ? "Se connecter" : "Créer un compte"}</button></p></div></section>
  </main>;

  return <div className="app-shell">
    <aside className="sidebar"><Link className="brand" href="/" aria-label="TaskHub, accueil"><span className="brand-icon">▦</span> TaskHub</Link><p className="nav-label">ESPACE DE TRAVAIL</p><label className="sr-only" htmlFor="workspace">Espace de travail</label><select id="workspace" value={workspaceId ?? ""} onChange={e => changeWorkspace(Number(e.target.value))} disabled={busy}>{workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select><button className="text-button" onClick={() => open({ kind: "workspace" })}>+ Nouvel espace</button><div className="nav-heading"><p className="nav-label">MES PROJETS</p><button aria-label="Créer un projet" onClick={() => open({ kind: "project" })} disabled={!workspaceId}>+</button></div><nav aria-label="Projets">{projects.map(p => <button key={p.id} className={`project-link ${p.id === projectId ? "active" : ""}`} onClick={() => changeProject(p.id)}><span>▤</span>{p.name}</button>)}</nav>{!projects.length && <p className="muted small">Tes projets apparaîtront ici.</p>}<div className="sidebar-bottom"><div className="sidebar-tip"><strong>Un pas après l’autre.</strong><p>Une tâche terminée, c’est une idée qui prend vie.</p></div><div className="profile"><span className="avatar">{session.user.name.slice(0,1).toUpperCase()}</span><div><strong>{session.user.name}</strong><small>{session.user.email}</small></div></div><button className="text-button" onClick={logout}>Se déconnecter</button></div></aside>
    <main className="workspace-main"><header className="topbar"><span>{workspace?.name ?? "Chargement…"} <span className="muted">/</span> Projets</span><div className="team">{members.slice(0,4).map(m => <span className="avatar small-avatar" key={m.id} title={m.name}>{m.name.slice(0,1).toUpperCase()}</span>)}{workspace?.role === "owner" && <button className="secondary" onClick={() => open({ kind: "member" })}>+ Ajouter un membre</button>}</div></header>
    <div className="content"><div className="page-heading"><div><span className="eyebrow">FAIRE PLACE AU PROGRÈS</span><h1>{currentBoard?.project.name ?? "Vos projets, en mouvement."}</h1><p>{currentBoard?.project.description || "Les idées s’organisent. Les prochaines étapes se dessinent."}</p></div>{currentBoard && <div className="heading-actions"><button className="secondary" onClick={() => open({kind:"project", project: currentBoard.project})}>Modifier le projet</button><button className="primary" onClick={() => open({ kind: "task", columnId: currentBoard.columns[0].id })}>+ Nouvelle tâche</button></div>}</div>
    {error && !editor && <div className="alert" role="alert">{error}<button className="text-button" onClick={() => { setError(""); setRevision(r => r + 1); }}>Réessayer</button></div>}{notice && <div className="notice" role="status">✓ {notice}</div>}
    {currentBoard ? <><section className="stats" aria-label="Statistiques du projet"><div><span>Tâches au total</span><strong>{currentBoard.stats.total.toString().padStart(2,"0")}</strong><small>Chaque étape compte</small></div><div><span>Terminées</span><strong>{currentBoard.stats.done.toString().padStart(2,"0")} <i>✓</i></strong><small>Du concret, enfin</small></div><div><span>À rattraper</span><strong>{currentBoard.stats.overdue.toString().padStart(2,"0")}</strong><small>Échéances dépassées</small></div><div className="progress-stat"><span>Progression</span><strong>{currentBoard.stats.total ? Math.round(currentBoard.stats.done/currentBoard.stats.total*100) : 0}<em>%</em></strong><progress max={currentBoard.stats.total || 1} value={currentBoard.stats.done} aria-label="Progression du projet" /></div></section>
    <div className="board-toolbar"><h2>Tableau de bord <span className="view-pill">KANBAN</span></h2><div className="filters"><label className="sr-only" htmlFor="search">Rechercher une tâche</label><input id="search" type="search" placeholder="Rechercher une tâche…" value={query} onChange={e => setQuery(e.target.value)} /><label className="sr-only" htmlFor="priority">Filtrer par priorité</label><select id="priority" value={priority} onChange={e => setPriority(e.target.value)}><option value="">Toutes les priorités</option>{Object.entries(priorities).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></div></div>
    <div className="board" aria-busy={loading}>{currentBoard.columns.map((column, index) => { const tasks = currentBoard.tasks.filter(t => t.column_id === column.id); return <section className={`column column-${index}`} key={column.id} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const id = Number(e.dataTransfer.getData("text/plain")); const task = currentBoard.tasks.find(t => t.id === id); if (task) void moveTask(task, column.id); }}><div className="column-heading"><h3><span className="dot" />{column.name} <span className="count">{tasks.length}</span></h3><button aria-label={`Ajouter une tâche dans ${column.name}`} onClick={() => open({ kind: "task", columnId: column.id })}>+</button></div>{tasks.map(task => { const assignee = members.find(m => m.id === task.assignee_id); const overdue = !!task.due_date && task.due_date < localDate() && index !== 2; return <article className="task-card" key={task.id} draggable={!busy} onDragStart={e => e.dataTransfer.setData("text/plain", String(task.id))}><div className="card-top"><span className={`priority-badge ${task.priority}`}>{priorities[task.priority]}</span><button aria-label={`Modifier ${task.title}`} onClick={() => open({ kind: "task", task, columnId: task.column_id })}>•••</button></div><button className="task-title" onClick={() => open({ kind: "task", task, columnId: task.column_id })}>{task.title}</button>{task.description && <p className="task-description">{task.description}</p>}<div className="task-footer"><span className={overdue ? "overdue" : "muted"}>{task.due_date ? new Date(task.due_date + "T12:00:00").toLocaleDateString("fr-FR", {day:"numeric", month:"short"}) : "Sans échéance"}</span>{assignee && <span className="avatar small-avatar" title={assignee.name}>{assignee.name.slice(0,1).toUpperCase()}</span>}</div><label className="sr-only" htmlFor={`move-${task.id}`}>Déplacer {task.title}</label><select id={`move-${task.id}`} className="move-select" value={task.column_id} onChange={e => void moveTask(task, Number(e.target.value))} disabled={busy}>{currentBoard.columns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></article>; })}{!tasks.length && <p className="column-empty">{query || priority ? "Aucun résultat ici." : "De la place pour la suite."}</p>}<button className="add-task" onClick={() => open({kind:"task", columnId: column.id})}>+ Ajouter une tâche</button></section>; })}</div>
    <footer className="board-bottom"><span>{loading ? "Mise à jour…" : "Déplace les cartes entre les colonnes, ou utilise leur menu de statut."}</span>{workspace?.role === "owner" && <button className="danger-link" disabled={busy} onClick={() => { if(window.confirm("Supprimer ce projet et toutes ses tâches ?")) void action(async () => { await request(`/projects/${projectId}`, token, "DELETE"); changeProject(null); setRevision(r=>r+1); }); }}>Supprimer le projet</button>}</footer></> : <section className="empty-state"><div className="empty-icon">▤</div><h2>{projectId ? "Chargement du tableau…" : "Tout commence par un projet."}</h2><p>{projectId ? "Nous préparons tes tâches." : "Crée un projet, pose tes premières tâches et donne une direction à tes idées."}</p>{!projectId && <button className="primary" onClick={() => open({ kind: "project" })} disabled={!workspaceId}>+ Créer mon premier projet</button>}</section>}
    </div></main>
    <dialog ref={dialogRef} onCancel={e => { if(busy) e.preventDefault(); else setEditor(null); }} onClose={() => { if(!busy) setEditor(null); }} aria-labelledby="editor-title">{editor && <form onSubmit={save}><div className="dialog-heading"><h2 id="editor-title">{editor.kind === "task" ? editor.task ? "Modifier la tâche" : "Nouvelle tâche" : editor.kind === "project" ? editor.project ? "Modifier le projet" : "Nouveau projet" : editor.kind === "workspace" ? "Nouvel espace" : "Ajouter un membre"}</h2><button type="button" onClick={() => setEditor(null)} disabled={busy} aria-label="Fermer">×</button></div>{error && <div className="alert" role="alert">{error}</div>}{editor.kind === "member" ? <><p className="muted">La personne doit déjà avoir un compte TaskHub. Elle aura accès à tous les projets de cet espace.</p><label>Adresse e-mail<input name="email" type="email" required autoFocus /></label></> : editor.kind === "task" ? <><label>Titre<input name="title" required maxLength={200} defaultValue={editor.task?.title} autoFocus /></label><label>Description<textarea name="description" maxLength={10000} rows={3} defaultValue={editor.task?.description ?? ""} /></label><div className="form-row"><label>Statut<select name="column_id" defaultValue={editor.columnId}>{currentBoard?.columns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Priorité<select name="priority" defaultValue={editor.task?.priority ?? "medium"}>{Object.entries(priorities).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label></div><div className="form-row"><label>Échéance<input name="due_date" type="date" defaultValue={editor.task?.due_date ?? ""} /></label><label>Assignée à<select name="assignee_id" defaultValue={editor.task?.assignee_id ?? ""}><option value="">Non assignée</option>{members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label></div></> : <><label>Nom<input name="name" required maxLength={120} defaultValue={editor.kind === "project" ? editor.project?.name : ""} autoFocus /></label>{editor.kind === "project" && <label>Description<textarea name="description" maxLength={5000} rows={3} defaultValue={editor.project?.description ?? ""} /></label>}</>}<div className="dialog-actions">{editor.kind === "task" && editor.task && <button type="button" className="danger-link" disabled={busy} onClick={() => void deleteTask(editor.task!)}>Supprimer</button>}<button type="button" className="secondary" disabled={busy} onClick={() => setEditor(null)}>Annuler</button><button className="primary" disabled={busy}>{busy ? "Enregistrement…" : "Enregistrer"}</button></div></form>}</dialog>
  </div>;
}
