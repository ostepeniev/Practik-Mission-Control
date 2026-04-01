"""Metrics router — KPIs, product table, time series, top lists."""
from datetime import date, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.services.auth import get_current_user
from backend.services.analytics import (
    get_kpi_overview, get_products_table, get_daily_series,
    get_top_products, get_top_customers, get_product_detail, get_alerts
)
from backend.models.app import User

router = APIRouter(prefix="/api/metrics", tags=["metrics"])


def parse_date(d: Optional[str]) -> Optional[date]:
    if d:
        return date.fromisoformat(d)
    return None


@router.get("/overview")
def overview(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    category_id: Optional[int] = None,
    product_id: Optional[int] = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return get_kpi_overview(
        db, parse_date(date_from), parse_date(date_to),
        category_id, product_id
    )


@router.get("/products")
def products_table(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    category_id: Optional[int] = None,
    sort_by: str = "revenue",
    sort_dir: str = "desc",
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return get_products_table(
        db, parse_date(date_from), parse_date(date_to),
        category_id, sort_by, sort_dir
    )


@router.get("/products/{product_id}")
def product_detail(
    product_id: int,
    days: int = 30,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    result = get_product_detail(db, product_id, days)
    if not result:
        return {"error": "Product not found"}
    return result


@router.get("/series/{metric}")
def daily_series(
    metric: str,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    category_id: Optional[int] = None,
    product_id: Optional[int] = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return get_daily_series(
        db, metric, parse_date(date_from), parse_date(date_to),
        category_id, product_id
    )


@router.get("/top-products")
def top_products(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    limit: int = 5,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return get_top_products(db, parse_date(date_from), parse_date(date_to), limit)


@router.get("/top-customers")
def top_customers(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    limit: int = 5,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return get_top_customers(db, parse_date(date_from), parse_date(date_to), limit)


@router.get("/alerts")
def alerts(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return get_alerts(db, parse_date(date_from), parse_date(date_to))
