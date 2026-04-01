"""AI router — insights + ask questions."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.services.auth import get_current_user
from backend.services.ai_gateway import AIGateway
from backend.services.analytics import get_kpi_overview, get_alerts
from backend.models.app import User
from backend.models.ai import AIInsight

router = APIRouter(prefix="/api/ai", tags=["ai"])


class AskRequest(BaseModel):
    question: str
    product_id: int = None
    context: str = ""


@router.get("/insights")
def get_insights(
    limit: int = 10,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    insights = (
        db.query(AIInsight)
        .filter(AIInsight.is_active == True)
        .order_by(AIInsight.created_at.desc())
        .limit(limit)
        .all()
    )
    return {
        "insights": [
            {
                "id": i.id,
                "type": i.insight_type,
                "severity": i.severity,
                "title": i.title,
                "body": i.body,
                "product_id": i.related_product_id,
                "metric": i.related_metric,
                "confidence": i.confidence,
                "is_read": i.is_read,
                "created_at": i.created_at.isoformat() if i.created_at else None,
            }
            for i in insights
        ],
        "total": len(insights),
    }


@router.post("/ask")
async def ask_ai(
    req: AskRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Build context from current data
    context_parts = []
    try:
        overview = get_kpi_overview(db)
        context_parts.append(f"KPI Overview: {overview['metrics']}")
    except Exception:
        pass

    try:
        alerts_data = get_alerts(db)
        if alerts_data["alerts"]:
            context_parts.append(f"Active alerts: {alerts_data['alerts'][:5]}")
    except Exception:
        pass

    if req.context:
        context_parts.append(req.context)

    context = "\n".join(str(c) for c in context_parts)

    gateway = AIGateway(db)
    result = await gateway.ask(
        question=req.question,
        context=context,
        task_type="ask",
    )

    return result


@router.patch("/insights/{insight_id}/read")
def mark_read(
    insight_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    insight = db.query(AIInsight).filter(AIInsight.id == insight_id).first()
    if insight:
        insight.is_read = True
        db.commit()
    return {"ok": True}
