import os
from datetime import date
from fastapi import FastAPI, Depends, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, text, delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from database import engine, get_db
from models import User, Workspace, WorkspaceMember, Project, BoardColumn, Task
from schemas import Register, Login, UserOut, WorkspaceIn, ProjectIn, MemberIn, TaskIn, TaskPatch, TaskOut
from security import hasher, verify_password, issue_token, current_user, DUMMY_HASH

app = FastAPI(title="TaskHub API", version="1.0.0")
origins = [x.strip() for x in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if x.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST", "PATCH", "DELETE"], allow_headers=["Authorization", "Content-Type"])

def membership(db, workspace_id, user, owner=False):
    member = db.get(WorkspaceMember, (workspace_id, user.id))
    if not member:
        raise HTTPException(404, "Espace introuvable.")
    if owner and member.role != "owner":
        raise HTTPException(403, "Action réservée au propriétaire de l’espace.")
    return member

def project_for(db, project_id, user, owner=False):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Projet introuvable.")
    membership(db, project.workspace_id, user, owner)
    return project

def task_for(db, task_id, user):
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(404, "Tâche introuvable.")
    project_for(db, task.project_id, user)
    return task

def validate_task(db, project, values):
    if "column_id" in values:
        column = db.get(BoardColumn, values["column_id"])
        if not column or column.project_id != project.id:
            raise HTTPException(422, "La colonne doit appartenir au projet.")
    if values.get("assignee_id") is not None and not db.get(WorkspaceMember, (project.workspace_id, values["assignee_id"])):
        raise HTTPException(422, "La personne assignée doit être membre de l’espace.")

def project_out(project):
    return {"id": project.id, "workspace_id": project.workspace_id, "name": project.name, "description": project.description}

def session_out(user):
    return {"access_token": issue_token(user), "token_type": "bearer", "user": UserOut.model_validate(user)}

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/health/database")
def database_health(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"status": "ok", "database": "connected"}

@app.post("/auth/register", status_code=201)
def register(data: Register, db: Session = Depends(get_db)):
    user = User(name=data.name, email=str(data.email).lower(), password_hash=hasher.hash(data.password))
    db.add(user)
    try:
        db.flush()
        workspace = Workspace(name="Mon espace", created_by_id=user.id)
        db.add(workspace)
        db.flush()
        db.add(WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role="owner"))
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Un compte utilise déjà cette adresse.")
    return session_out(user)

@app.post("/auth/login")
def login(data: Login, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == str(data.email).lower()))
    valid = verify_password(data.password, user.password_hash if user else DUMMY_HASH)
    if not user or not valid:
        raise HTTPException(401, "Adresse ou mot de passe incorrect.")
    return session_out(user)

@app.get("/auth/me", response_model=UserOut)
def me(user: User = Depends(current_user)):
    return user

@app.get("/workspaces")
def workspaces(db: Session = Depends(get_db), user: User = Depends(current_user)):
    rows = db.execute(select(Workspace, WorkspaceMember.role).join(WorkspaceMember).where(WorkspaceMember.user_id == user.id).order_by(Workspace.id)).all()
    return [{"id": w.id, "name": w.name, "role": role} for w, role in rows]

@app.post("/workspaces", status_code=201)
def create_workspace(data: WorkspaceIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    w = Workspace(name=data.name, created_by_id=user.id)
    db.add(w)
    db.flush()
    db.add(WorkspaceMember(workspace_id=w.id, user_id=user.id, role="owner"))
    db.commit()
    return {"id": w.id, "name": w.name, "role": "owner"}

@app.get("/workspaces/{workspace_id}/members")
def members(workspace_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    membership(db, workspace_id, user)
    rows = db.execute(select(User, WorkspaceMember.role).join(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace_id)).all()
    return [{**UserOut.model_validate(u).model_dump(), "role": role} for u, role in rows]

@app.post("/workspaces/{workspace_id}/members", status_code=201)
def add_member(workspace_id: int, data: MemberIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    membership(db, workspace_id, user, owner=True)
    invited = db.scalar(select(User).where(User.email == str(data.email).lower()))
    if not invited:
        raise HTTPException(404, "Cette personne doit d’abord créer son compte TaskHub.")
    db.add(WorkspaceMember(workspace_id=workspace_id, user_id=invited.id, role="member"))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Cette personne est déjà membre.")
    return UserOut.model_validate(invited)

@app.get("/workspaces/{workspace_id}/projects")
def projects(workspace_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    membership(db, workspace_id, user)
    return [project_out(p) for p in db.scalars(select(Project).where(Project.workspace_id == workspace_id).order_by(Project.id))]

@app.post("/workspaces/{workspace_id}/projects", status_code=201)
def create_project(workspace_id: int, data: ProjectIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    membership(db, workspace_id, user)
    p = Project(workspace_id=workspace_id, created_by_id=user.id, **data.model_dump())
    db.add(p)
    db.flush()
    db.add_all([BoardColumn(project_id=p.id, name=name, position=i) for i, name in enumerate(["À faire", "En cours", "Terminé"])])
    db.commit()
    return project_out(p)

@app.patch("/projects/{project_id}")
def update_project(project_id: int, data: ProjectIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    p = project_for(db, project_id, user)
    p.name, p.description = data.name, data.description
    db.commit()
    return project_out(p)

@app.delete("/projects/{project_id}", status_code=204)
def delete_project(project_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    p = project_for(db, project_id, user, owner=True)
    # Remove tasks first: each task references both its project and its column.
    db.execute(delete(Task).where(Task.project_id == p.id))
    db.delete(p)
    db.commit()
    return Response(status_code=204)

@app.get("/projects/{project_id}/board")
def board(project_id: int, q: str = Query(default="", max_length=200), priority: str | None = Query(default=None, pattern="^(low|medium|high)$"), db: Session = Depends(get_db), user: User = Depends(current_user)):
    p = project_for(db, project_id, user)
    columns = list(db.scalars(select(BoardColumn).where(BoardColumn.project_id == p.id).order_by(BoardColumn.position)))
    all_tasks = list(db.scalars(select(Task).where(Task.project_id == p.id).order_by(Task.created_at.desc(), Task.id.desc())))
    tasks = [t for t in all_tasks if (not q or q.lower() in (t.title + " " + (t.description or "")).lower()) and (not priority or t.priority == priority)]
    done_id = columns[-1].id
    return {"project": project_out(p), "columns": [{"id": c.id, "name": c.name, "position": c.position} for c in columns],
            "tasks": [TaskOut.model_validate(t) for t in tasks],
            "stats": {"total": len(all_tasks), "done": sum(t.column_id == done_id for t in all_tasks), "overdue": sum(bool(t.due_date and t.due_date < date.today() and t.column_id != done_id) for t in all_tasks)}}

@app.post("/projects/{project_id}/tasks", response_model=TaskOut, status_code=201)
def create_task(project_id: int, data: TaskIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    p = project_for(db, project_id, user)
    values = data.model_dump()
    validate_task(db, p, values)
    t = Task(project_id=p.id, created_by_id=user.id, **values)
    db.add(t)
    db.commit()
    db.refresh(t)
    return t

@app.patch("/tasks/{task_id}", response_model=TaskOut)
def update_task(task_id: int, data: TaskPatch, db: Session = Depends(get_db), user: User = Depends(current_user)):
    t = task_for(db, task_id, user)
    values = data.model_dump(exclude_unset=True)
    validate_task(db, t.project, values)
    for key, value in values.items():
        setattr(t, key, value)
    db.commit()
    db.refresh(t)
    return t

@app.delete("/tasks/{task_id}", status_code=204)
def delete_task(task_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    db.delete(task_for(db, task_id, user))
    db.commit()
    return Response(status_code=204)
