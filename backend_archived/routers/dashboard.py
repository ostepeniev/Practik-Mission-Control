"""Dashboard config router — widget-driven layout API."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.services.auth import get_current_user
from backend.models.app import User, Dashboard, DashboardTab, Widget

router = APIRouter(prefix="/api/dashboards", tags=["dashboards"])


@router.get("")
def list_dashboards(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    dashboards = db.query(Dashboard).filter(Dashboard.is_active == True).order_by(Dashboard.sort_order).all()
    return {
        "dashboards": [
            {
                "id": d.id, "slug": d.slug, "title": d.title,
                "description": d.description, "icon": d.icon
            }
            for d in dashboards
        ]
    }


@router.get("/{slug}/config")
def get_dashboard_config(slug: str, user: User = Depends(get_current_user),
                         db: Session = Depends(get_db)):
    dashboard = db.query(Dashboard).filter(Dashboard.slug == slug).first()
    if not dashboard:
        return {"error": "Dashboard not found"}

    tabs = (
        db.query(DashboardTab)
        .filter(DashboardTab.dashboard_id == dashboard.id)
        .filter(DashboardTab.is_active == True)
        .order_by(DashboardTab.sort_order)
        .all()
    )

    tabs_data = []
    for tab in tabs:
        widgets_q = (
            db.query(Widget)
            .filter(Widget.tab_id == tab.id)
            .filter(Widget.is_active == True)
        )
        # Owner only sees widgets marked visible
        if user.role != "developer":
            widgets_q = widgets_q.filter(Widget.is_visible_owner == True)

        widgets = widgets_q.order_by(Widget.row, Widget.col, Widget.sort_order).all()

        tabs_data.append({
            "id": tab.id,
            "slug": tab.slug,
            "title": tab.title,
            "widgets": [
                {
                    "id": w.id,
                    "widget_type": w.widget_type,
                    "title": w.title,
                    "subtitle": w.subtitle,
                    "data_source": w.data_source,
                    "config": w.config_json or {},
                    "size": w.size,
                    "row": w.row,
                    "col": w.col,
                    "is_visible_owner": w.is_visible_owner,
                }
                for w in widgets
            ]
        })

    return {
        "dashboard": {
            "id": dashboard.id,
            "slug": dashboard.slug,
            "title": dashboard.title,
            "description": dashboard.description,
            "icon": dashboard.icon,
        },
        "tabs": tabs_data,
        "user_role": user.role,
    }
