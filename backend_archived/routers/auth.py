"""Auth router — login + current user."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.services.auth import authenticate_user, create_token, get_current_user
from backend.models.app import User

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    token: str
    user: dict


class UserResponse(BaseModel):
    id: int
    username: str
    display_name: str
    role: str


@router.post("/login", response_model=LoginResponse)
def login(req: LoginRequest, db: Session = Depends(get_db)):
    user = authenticate_user(db, req.username, req.password)
    if not user:
        raise HTTPException(status_code=401, detail="Невірний логін або пароль")
    token = create_token(user.id, user.role)
    return LoginResponse(
        token=token,
        user={"id": user.id, "username": user.username,
              "display_name": user.display_name, "role": user.role}
    )


@router.get("/me", response_model=UserResponse)
def me(user: User = Depends(get_current_user)):
    return UserResponse(
        id=user.id, username=user.username,
        display_name=user.display_name, role=user.role
    )
