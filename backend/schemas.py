from datetime import date, datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

class Register(Input):
    name: str = Field(min_length=1, max_length=100)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)

class Login(Input):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)

class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    email: str

class WorkspaceIn(Input):
    name: str = Field(min_length=1, max_length=120)

class ProjectIn(WorkspaceIn):
    description: str | None = Field(default=None, max_length=5000)

class MemberIn(Input):
    email: EmailStr

class TaskIn(Input):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=10000)
    column_id: int
    priority: Literal["low", "medium", "high"] = "medium"
    due_date: date | None = None
    assignee_id: int | None = None

class TaskPatch(Input):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=10000)
    column_id: int | None = None
    priority: Literal["low", "medium", "high"] | None = None
    due_date: date | None = None
    assignee_id: int | None = None

    @field_validator("title", "column_id", "priority")
    @classmethod
    def non_nullable(cls, value):
        if value is None:
            raise ValueError("Ce champ ne peut pas être nul.")
        return value

class TaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    project_id: int
    column_id: int
    title: str
    description: str | None
    priority: str
    due_date: date | None
    assignee_id: int | None
    created_at: datetime
    updated_at: datetime
