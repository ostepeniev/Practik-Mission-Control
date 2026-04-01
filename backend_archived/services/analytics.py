"""Deterministic analytics engine.
Rules-based anomaly detection and metric calculation.
AI layer works ON TOP of results from this engine.
"""
from datetime import date, timedelta
from decimal import Decimal
from sqlalchemy import func, case, and_, or_
from sqlalchemy.orm import Session

from backend.models.core import (
    Product, ProductCategory, SalesOrder, SalesOrderItem, Return, Customer, Manager
)


def get_kpi_overview(db: Session, date_from: date = None, date_to: date = None,
                     category_id: int = None, product_id: int = None):
    """Calculate main KPI metrics for the overview."""
    today = date.today()
    if not date_to:
        date_to = today
    if not date_from:
        # MTD by default
        date_from = today.replace(day=1)

    # Base query for current period
    base_q = (
        db.query(
            func.sum(SalesOrderItem.final_price).label("revenue"),
            func.sum(SalesOrderItem.cost_price_at_sale * SalesOrderItem.quantity).label("cogs"),
            func.sum(SalesOrderItem.quantity).label("volume"),
            func.count(func.distinct(SalesOrderItem.order_id)).label("order_count"),
        )
        .join(SalesOrder, SalesOrderItem.order_id == SalesOrder.id)
        .filter(SalesOrder.order_date >= date_from)
        .filter(SalesOrder.order_date <= date_to)
        .filter(SalesOrder.status != "cancelled")
    )

    if category_id:
        base_q = base_q.join(Product, SalesOrderItem.product_id == Product.id).filter(Product.category_id == category_id)
    if product_id:
        base_q = base_q.filter(SalesOrderItem.product_id == product_id)

    result = base_q.first()
    revenue = float(result.revenue or 0)
    cogs = float(result.cogs or 0)
    volume = float(result.volume or 0)
    order_count = int(result.order_count or 0)

    margin_pct = ((revenue - cogs) / revenue * 100) if revenue > 0 else 0
    margin_amount = revenue - cogs

    # Returns
    returns_q = (
        db.query(func.sum(Return.quantity))
        .join(SalesOrderItem, Return.order_item_id == SalesOrderItem.id)
        .join(SalesOrder, SalesOrderItem.order_id == SalesOrder.id)
        .filter(SalesOrder.order_date >= date_from)
        .filter(SalesOrder.order_date <= date_to)
    )
    returned_qty = float(returns_q.scalar() or 0)
    returns_pct = (returned_qty / volume * 100) if volume > 0 else 0

    # Previous period for comparison
    period_days = (date_to - date_from).days + 1
    prev_from = date_from - timedelta(days=period_days)
    prev_to = date_from - timedelta(days=1)

    prev_q = (
        db.query(
            func.sum(SalesOrderItem.final_price).label("revenue"),
            func.sum(SalesOrderItem.cost_price_at_sale * SalesOrderItem.quantity).label("cogs"),
            func.sum(SalesOrderItem.quantity).label("volume"),
            func.count(func.distinct(SalesOrderItem.order_id)).label("order_count"),
        )
        .join(SalesOrder, SalesOrderItem.order_id == SalesOrder.id)
        .filter(SalesOrder.order_date >= prev_from)
        .filter(SalesOrder.order_date <= prev_to)
        .filter(SalesOrder.status != "cancelled")
    )

    if category_id:
        prev_q = prev_q.join(Product, SalesOrderItem.product_id == Product.id).filter(Product.category_id == category_id)
    if product_id:
        prev_q = prev_q.filter(SalesOrderItem.product_id == product_id)

    prev = prev_q.first()
    prev_revenue = float(prev.revenue or 0)
    prev_cogs = float(prev.cogs or 0)
    prev_volume = float(prev.volume or 0)
    prev_order_count = int(prev.order_count or 0)
    prev_margin_pct = ((prev_revenue - prev_cogs) / prev_revenue * 100) if prev_revenue > 0 else 0

    def delta_pct(current, previous):
        if previous == 0:
            return 0
        return round((current - previous) / previous * 100, 1)

    return {
        "period": {"from": date_from.isoformat(), "to": date_to.isoformat()},
        "metrics": {
            "revenue_mtd": {
                "value": round(revenue, 2),
                "delta_pct": delta_pct(revenue, prev_revenue),
                "prev_value": round(prev_revenue, 2),
                "format": "currency",
                "unit": "₴"
            },
            "gross_margin_pct": {
                "value": round(margin_pct, 1),
                "delta_pct": round(margin_pct - prev_margin_pct, 1),
                "prev_value": round(prev_margin_pct, 1),
                "format": "percent",
                "unit": "%"
            },
            "gross_margin_amount": {
                "value": round(margin_amount, 2),
                "delta_pct": delta_pct(margin_amount, prev_revenue - prev_cogs),
                "prev_value": round(prev_revenue - prev_cogs, 2),
                "format": "currency",
                "unit": "₴"
            },
            "sales_volume": {
                "value": round(volume, 1),
                "delta_pct": delta_pct(volume, prev_volume),
                "prev_value": round(prev_volume, 1),
                "format": "number",
                "unit": "кг"
            },
            "order_count": {
                "value": order_count,
                "delta_pct": delta_pct(order_count, prev_order_count),
                "prev_value": prev_order_count,
                "format": "number",
                "unit": "шт"
            },
            "returns_pct": {
                "value": round(returns_pct, 2),
                "delta_pct": 0,
                "prev_value": 0,
                "format": "percent",
                "unit": "%",
                "inverse": True
            },
        },
        "last_updated": date.today().isoformat(),
        "freshness_status": "fresh"
    }


def get_products_table(db: Session, date_from: date = None, date_to: date = None,
                       category_id: int = None, sort_by: str = "revenue", sort_dir: str = "desc"):
    """Get product-level analytics table with status classification."""
    today = date.today()
    if not date_to:
        date_to = today
    if not date_from:
        date_from = today - timedelta(days=30)

    # Current period
    products_data = (
        db.query(
            Product.id,
            Product.name,
            Product.sku,
            Product.status.label("product_status"),
            Product.target_margin_pct,
            Product.launch_date,
            ProductCategory.name.label("category_name"),
            func.sum(SalesOrderItem.final_price).label("revenue"),
            func.sum(SalesOrderItem.cost_price_at_sale * SalesOrderItem.quantity).label("cogs"),
            func.sum(SalesOrderItem.quantity).label("quantity"),
            func.count(func.distinct(SalesOrderItem.order_id)).label("orders"),
            func.avg(SalesOrderItem.discount_pct).label("avg_discount"),
            func.sum(case((SalesOrderItem.is_promo == True, SalesOrderItem.quantity), else_=0)).label("promo_qty"),
        )
        .join(ProductCategory, Product.category_id == ProductCategory.id)
        .outerjoin(SalesOrderItem, SalesOrderItem.product_id == Product.id)
        .outerjoin(SalesOrder, and_(
            SalesOrderItem.order_id == SalesOrder.id,
            SalesOrder.order_date >= date_from,
            SalesOrder.order_date <= date_to,
            SalesOrder.status != "cancelled"
        ))
        .group_by(Product.id, Product.name, Product.sku, Product.status,
                  Product.target_margin_pct, Product.launch_date, ProductCategory.name)
    )

    if category_id:
        products_data = products_data.filter(Product.category_id == category_id)

    # Previous period for comparison
    period_days = (date_to - date_from).days + 1
    prev_from = date_from - timedelta(days=period_days)
    prev_to = date_from - timedelta(days=1)

    prev_data = {}
    prev_q = (
        db.query(
            SalesOrderItem.product_id,
            func.sum(SalesOrderItem.final_price).label("revenue"),
            func.sum(SalesOrderItem.cost_price_at_sale * SalesOrderItem.quantity).label("cogs"),
            func.sum(SalesOrderItem.quantity).label("quantity"),
        )
        .join(SalesOrder, SalesOrderItem.order_id == SalesOrder.id)
        .filter(SalesOrder.order_date >= prev_from)
        .filter(SalesOrder.order_date <= prev_to)
        .filter(SalesOrder.status != "cancelled")
        .group_by(SalesOrderItem.product_id)
    )
    for row in prev_q.all():
        prev_data[row.product_id] = {
            "revenue": float(row.revenue or 0),
            "cogs": float(row.cogs or 0),
            "quantity": float(row.quantity or 0),
        }

    results = []
    for row in products_data.all():
        revenue = float(row.revenue or 0)
        cogs = float(row.cogs or 0)
        quantity = float(row.quantity or 0)
        margin_pct = ((revenue - cogs) / revenue * 100) if revenue > 0 else 0
        margin_amount = revenue - cogs
        avg_price = (revenue / quantity) if quantity > 0 else 0

        prev = prev_data.get(row.id, {"revenue": 0, "cogs": 0, "quantity": 0})
        prev_margin_pct = ((prev["revenue"] - prev["cogs"]) / prev["revenue"] * 100) if prev["revenue"] > 0 else 0

        def delta(curr, prev_val):
            if prev_val == 0:
                return 0
            return round((curr - prev_val) / prev_val * 100, 1)

        delta_revenue = delta(revenue, prev["revenue"])
        delta_margin = round(margin_pct - prev_margin_pct, 1)

        # Status classification
        status = classify_product_status(
            margin_pct, prev_margin_pct, delta_revenue,
            float(row.avg_discount or 0), float(row.promo_qty or 0),
            row.launch_date, row.target_margin_pct or 30
        )

        results.append({
            "id": row.id,
            "name": row.name,
            "sku": row.sku,
            "category": row.category_name,
            "product_status": row.product_status,
            "revenue": round(revenue, 2),
            "cogs": round(cogs, 2),
            "margin_pct": round(margin_pct, 1),
            "margin_amount": round(margin_amount, 2),
            "quantity": round(quantity, 1),
            "orders": int(row.orders or 0),
            "avg_price": round(avg_price, 2),
            "avg_discount": round(float(row.avg_discount or 0), 1),
            "promo_qty": round(float(row.promo_qty or 0), 1),
            "delta_revenue_pct": delta_revenue,
            "delta_margin_pp": delta_margin,
            "status": status,
            "is_new": row.product_status == "new",
            "launch_date": row.launch_date.isoformat() if row.launch_date else None,
        })

    # Sort
    reverse = sort_dir == "desc"
    if sort_by in ("revenue", "margin_pct", "quantity", "orders", "delta_revenue_pct", "delta_margin_pp"):
        results.sort(key=lambda x: x.get(sort_by, 0), reverse=reverse)
    elif sort_by == "status":
        status_order = {"critical": 0, "risk": 1, "attention": 2, "normal": 3, "new": 4}
        results.sort(key=lambda x: status_order.get(x.get("status", "normal"), 5), reverse=not reverse)

    return {
        "products": results,
        "total_count": len(results),
        "period": {"from": date_from.isoformat(), "to": date_to.isoformat()},
        "last_updated": today.isoformat(),
        "freshness_status": "fresh"
    }


def classify_product_status(margin_pct, prev_margin_pct, delta_revenue_pct,
                            avg_discount, promo_qty, launch_date, target_margin):
    """Classify product status: normal / attention / risk / critical / new."""
    today = date.today()

    # New products get special treatment
    if launch_date and (today - launch_date).days < 14:
        return "new"

    margin_drop = prev_margin_pct - margin_pct if prev_margin_pct > 0 else 0
    margin_drop_pct = (margin_drop / prev_margin_pct * 100) if prev_margin_pct > 0 else 0

    # Critical: margin dropped >30% AND suspicious signals
    if margin_drop_pct > 30 and (avg_discount > 20 or (promo_qty == 0 and margin_drop > 10)):
        return "critical"

    # Risk: margin or revenue deviated >30%
    if margin_drop_pct > 30 or abs(delta_revenue_pct) > 30:
        return "risk"

    # Attention: deviated 15-30%
    if margin_drop_pct > 15 or abs(delta_revenue_pct) > 25:
        return "attention"

    return "normal"


def get_daily_series(db: Session, metric: str, date_from: date = None, date_to: date = None,
                     category_id: int = None, product_id: int = None):
    """Get daily time series for a metric."""
    today = date.today()
    if not date_to:
        date_to = today
    if not date_from:
        date_from = today.replace(day=1)

    base = (
        db.query(
            SalesOrder.order_date.label("date"),
            func.sum(SalesOrderItem.final_price).label("revenue"),
            func.sum(SalesOrderItem.cost_price_at_sale * SalesOrderItem.quantity).label("cogs"),
            func.sum(SalesOrderItem.quantity).label("volume"),
            func.count(func.distinct(SalesOrderItem.order_id)).label("orders"),
        )
        .join(SalesOrder, SalesOrderItem.order_id == SalesOrder.id)
        .filter(SalesOrder.order_date >= date_from)
        .filter(SalesOrder.order_date <= date_to)
        .filter(SalesOrder.status != "cancelled")
    )

    if category_id:
        base = base.join(Product, SalesOrderItem.product_id == Product.id).filter(Product.category_id == category_id)
    if product_id:
        base = base.filter(SalesOrderItem.product_id == product_id)

    base = base.group_by(SalesOrder.order_date).order_by(SalesOrder.order_date)

    data = []
    for row in base.all():
        revenue = float(row.revenue or 0)
        cogs = float(row.cogs or 0)
        margin_pct = ((revenue - cogs) / revenue * 100) if revenue > 0 else 0

        point = {"date": row.date.isoformat()}
        if metric in ("revenue", "revenue_daily"):
            point["value"] = round(revenue, 2)
        elif metric in ("margin", "margin_daily"):
            point["value"] = round(margin_pct, 1)
        elif metric in ("volume", "volume_daily"):
            point["value"] = round(float(row.volume or 0), 1)
        elif metric in ("orders", "orders_daily"):
            point["value"] = int(row.orders or 0)
        data.append(point)

    return {"series": data, "metric": metric}


def get_top_products(db: Session, date_from: date = None, date_to: date = None,
                     limit: int = 5, by: str = "revenue"):
    today = date.today()
    if not date_to:
        date_to = today
    if not date_from:
        date_from = today.replace(day=1)

    q = (
        db.query(
            Product.id,
            Product.name,
            Product.sku,
            func.sum(SalesOrderItem.final_price).label("revenue"),
            func.sum(SalesOrderItem.quantity).label("quantity"),
        )
        .join(SalesOrderItem, SalesOrderItem.product_id == Product.id)
        .join(SalesOrder, SalesOrderItem.order_id == SalesOrder.id)
        .filter(SalesOrder.order_date >= date_from)
        .filter(SalesOrder.order_date <= date_to)
        .filter(SalesOrder.status != "cancelled")
        .group_by(Product.id, Product.name, Product.sku)
        .order_by(func.sum(SalesOrderItem.final_price).desc())
        .limit(limit)
    )

    return {
        "items": [
            {"id": r.id, "name": r.name, "sku": r.sku,
             "revenue": round(float(r.revenue or 0), 2),
             "quantity": round(float(r.quantity or 0), 1)}
            for r in q.all()
        ]
    }


def get_top_customers(db: Session, date_from: date = None, date_to: date = None,
                      limit: int = 5):
    today = date.today()
    if not date_to:
        date_to = today
    if not date_from:
        date_from = today.replace(day=1)

    q = (
        db.query(
            Customer.id,
            Customer.name,
            Customer.region,
            Customer.channel,
            func.sum(SalesOrderItem.final_price).label("revenue"),
            func.count(func.distinct(SalesOrder.id)).label("orders"),
            func.sum(SalesOrderItem.cost_price_at_sale * SalesOrderItem.quantity).label("cogs"),
        )
        .join(SalesOrder, Customer.id == SalesOrder.customer_id)
        .join(SalesOrderItem, SalesOrderItem.order_id == SalesOrder.id)
        .filter(SalesOrder.order_date >= date_from)
        .filter(SalesOrder.order_date <= date_to)
        .filter(SalesOrder.status != "cancelled")
        .group_by(Customer.id, Customer.name, Customer.region, Customer.channel)
        .order_by(func.sum(SalesOrderItem.final_price).desc())
        .limit(limit)
    )

    return {
        "items": [
            {
                "id": r.id, "name": r.name, "region": r.region, "channel": r.channel,
                "revenue": round(float(r.revenue or 0), 2),
                "orders": int(r.orders or 0),
                "margin_pct": round(
                    ((float(r.revenue or 0) - float(r.cogs or 0)) / float(r.revenue or 0) * 100)
                    if float(r.revenue or 0) > 0 else 0, 1
                ),
            }
            for r in q.all()
        ]
    }


def get_product_detail(db: Session, product_id: int, days: int = 30):
    """Get detailed analytics for a single product."""
    today = date.today()
    date_from = today - timedelta(days=days)

    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        return None

    category = db.query(ProductCategory).filter(ProductCategory.id == product.category_id).first()

    # Daily series
    daily = get_daily_series(db, "revenue", date_from, today, product_id=product_id)
    margin_daily = get_daily_series(db, "margin", date_from, today, product_id=product_id)

    # KPIs for this product
    kpis = get_kpi_overview(db, date_from, today, product_id=product_id)

    # Recent orders
    recent_orders = (
        db.query(
            SalesOrder.order_number,
            SalesOrder.order_date,
            Customer.name.label("customer_name"),
            Manager.name.label("manager_name"),
            SalesOrderItem.quantity,
            SalesOrderItem.unit_price,
            SalesOrderItem.discount_pct,
            SalesOrderItem.final_price,
            SalesOrderItem.is_promo,
            SalesOrderItem.promo_type,
        )
        .join(SalesOrderItem, SalesOrderItem.order_id == SalesOrder.id)
        .outerjoin(Customer, SalesOrder.customer_id == Customer.id)
        .outerjoin(Manager, SalesOrder.manager_id == Manager.id)
        .filter(SalesOrderItem.product_id == product_id)
        .filter(SalesOrder.order_date >= date_from)
        .order_by(SalesOrder.order_date.desc())
        .limit(20)
    )

    orders_list = [
        {
            "order_number": r.order_number,
            "date": r.order_date.isoformat(),
            "customer": r.customer_name,
            "manager": r.manager_name,
            "quantity": float(r.quantity),
            "unit_price": float(r.unit_price),
            "discount_pct": float(r.discount_pct),
            "final_price": float(r.final_price),
            "is_promo": r.is_promo,
            "promo_type": r.promo_type,
        }
        for r in recent_orders.all()
    ]

    return {
        "product": {
            "id": product.id,
            "name": product.name,
            "sku": product.sku,
            "category": category.name if category else "",
            "status": product.status,
            "launch_date": product.launch_date.isoformat() if product.launch_date else None,
            "target_margin_pct": float(product.target_margin_pct or 0),
            "current_cost_price": float(product.current_cost_price or 0),
            "recommended_sale_price": float(product.recommended_sale_price or 0),
        },
        "kpis": kpis["metrics"],
        "revenue_daily": daily["series"],
        "margin_daily": margin_daily["series"],
        "recent_orders": orders_list,
        "last_updated": today.isoformat(),
        "freshness_status": "fresh",
    }


def get_alerts(db: Session, date_from: date = None, date_to: date = None):
    """Get anomaly alerts based on deterministic rules."""
    today = date.today()
    if not date_to:
        date_to = today
    if not date_from:
        date_from = today - timedelta(days=7)

    products_data = get_products_table(db, date_from, date_to)
    alerts = []

    for p in products_data["products"]:
        if p["status"] in ("critical", "risk"):
            alert = {
                "product_id": p["id"],
                "product_name": p["name"],
                "sku": p["sku"],
                "severity": p["status"],
                "metrics": {
                    "margin_pct": p["margin_pct"],
                    "delta_margin_pp": p["delta_margin_pp"],
                    "delta_revenue_pct": p["delta_revenue_pct"],
                    "avg_discount": p["avg_discount"],
                    "promo_qty": p["promo_qty"],
                },
            }

            # Generate alert message
            messages = []
            if p["delta_margin_pp"] < -5:
                messages.append(f"Маржа впала на {abs(p['delta_margin_pp'])} п.п.")
            if p["delta_revenue_pct"] < -20:
                messages.append(f"Виторг впав на {abs(p['delta_revenue_pct'])}%")
            if p["delta_revenue_pct"] > 30:
                messages.append(f"Виторг зріс на {p['delta_revenue_pct']}% (перевірте маржу)")
            if p["avg_discount"] > 15:
                messages.append(f"Середня знижка {p['avg_discount']}% (вище норми)")

            alert["message"] = "; ".join(messages) if messages else f"Статус: {p['status']}"
            alerts.append(alert)

    alerts.sort(key=lambda x: 0 if x["severity"] == "critical" else 1)
    return {"alerts": alerts, "total": len(alerts)}
