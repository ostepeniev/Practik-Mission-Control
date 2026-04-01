"""Admin router — feature flags + widget visibility (Developer only)."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.services.auth import require_developer
from backend.models.app import User, FeatureFlag, Widget, ProductCategory

router = APIRouter(prefix="/api/admin", tags=["admin"])


class ToggleRequest(BaseModel):
    is_enabled: bool = None
    is_visible_owner: bool = None


@router.get("/features")
def list_features(user: User = Depends(require_developer), db: Session = Depends(get_db)):
    flags = db.query(FeatureFlag).all()
    return {
        "features": [
            {"id": f.id, "key": f.feature_key, "is_enabled": f.is_enabled,
             "description": f.description}
            for f in flags
        ]
    }


@router.patch("/features/{key}")
def toggle_feature(key: str, req: ToggleRequest,
                   user: User = Depends(require_developer), db: Session = Depends(get_db)):
    flag = db.query(FeatureFlag).filter(FeatureFlag.feature_key == key).first()
    if not flag:
        return {"error": "Feature not found"}
    if req.is_enabled is not None:
        flag.is_enabled = req.is_enabled
    db.commit()
    return {"ok": True, "key": flag.feature_key, "is_enabled": flag.is_enabled}


@router.get("/widgets")
def list_widgets(user: User = Depends(require_developer), db: Session = Depends(get_db)):
    widgets = db.query(Widget).order_by(Widget.tab_id, Widget.sort_order).all()
    return {
        "widgets": [
            {"id": w.id, "title": w.title, "widget_type": w.widget_type,
             "is_visible_owner": w.is_visible_owner, "is_active": w.is_active,
             "size": w.size, "tab_id": w.tab_id}
            for w in widgets
        ]
    }


@router.patch("/widgets/{widget_id}")
def toggle_widget(widget_id: int, req: ToggleRequest,
                  user: User = Depends(require_developer), db: Session = Depends(get_db)):
    widget = db.query(Widget).filter(Widget.id == widget_id).first()
    if not widget:
        return {"error": "Widget not found"}
    if req.is_visible_owner is not None:
        widget.is_visible_owner = req.is_visible_owner
    db.commit()
    return {"ok": True, "id": widget.id, "is_visible_owner": widget.is_visible_owner}


@router.get("/categories")
def list_categories(user: User = Depends(require_developer), db: Session = Depends(get_db)):
    cats = db.query(ProductCategory).all()
    return {
        "categories": [
            {"id": c.id, "name": c.name}
            for c in cats
        ]
    }
