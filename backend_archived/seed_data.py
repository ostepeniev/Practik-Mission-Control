"""Seed realistic demo data for Practik UA dashboard."""
import random
from datetime import date, timedelta, datetime
from decimal import Decimal
from passlib.hash import bcrypt
from sqlalchemy.orm import Session

from backend.models.core import (
    ProductCategory, Product, Customer, Manager,
    SalesOrder, SalesOrderItem, Return, CostPriceHistory
)
from backend.models.app import (
    User, Dashboard, DashboardTab, Widget, FeatureFlag, MetricDefinition
)
from backend.models.ai import AIProviderConfig, AIInsight


def seed_all(db: Session):
    """Run all seeders."""
    # Check if already seeded
    if db.query(User).first():
        print("Database already seeded, skipping.")
        return

    seed_users(db)
    cats = seed_categories(db)
    products = seed_products(db, cats)
    customers = seed_customers(db)
    managers = seed_managers(db)
    seed_cost_history(db, products)
    seed_sales(db, products, customers, managers)
    seed_dashboard_config(db)
    seed_metric_definitions(db)
    seed_feature_flags(db)
    seed_ai_config(db)
    seed_ai_insights(db, products)
    db.commit()
    print("✅ Database seeded successfully!")


def seed_users(db: Session):
    users = [
        User(
            username="dev",
            password_hash=bcrypt.hash("dev123"),
            display_name="Розробник",
            role="developer"
        ),
        User(
            username="ivan",
            password_hash=bcrypt.hash("owner123"),
            display_name="Іван (Власник)",
            role="owner"
        ),
    ]
    db.add_all(users)
    db.flush()


def seed_categories(db: Session) -> list:
    categories = [
        ProductCategory(id=1, name="Сухий корм для собак"),
        ProductCategory(id=2, name="Сухий корм для котів"),
        ProductCategory(id=3, name="Вологий корм для собак"),
        ProductCategory(id=4, name="Вологий корм для котів"),
        ProductCategory(id=5, name="Ласощі"),
        ProductCategory(id=6, name="Спеціалізований корм"),
    ]
    db.add_all(categories)
    db.flush()
    return categories


def seed_products(db: Session, categories: list) -> list:
    products_data = [
        # Сухий корм для собак
        ("Practik Adult Курка", 1, "PRK-DOG-CH-10", 10, 320, 520, 32),
        ("Practik Adult Яловичина", 1, "PRK-DOG-BF-10", 10, 340, 540, 30),
        ("Practik Adult Ягня", 1, "PRK-DOG-LM-10", 10, 360, 560, 28),
        ("Practik Puppy Курка", 1, "PRK-PUP-CH-10", 10, 350, 580, 35),
        ("Practik Adult Курка (Мін)", 1, "PRK-DOG-CH-3", 3, 110, 180, 30),
        ("Practik Adult Яловичина (Мін)", 1, "PRK-DOG-BF-3", 3, 120, 195, 28),
        ("Practik Maxi Курка", 1, "PRK-MAX-CH-20", 20, 600, 980, 33),
        ("Practik Senior Курка", 1, "PRK-SEN-CH-10", 10, 330, 550, 30),
        # Сухий корм для котів
        ("Practik Cat Курка", 2, "PRK-CAT-CH-4", 4, 180, 310, 35),
        ("Practik Cat Риба", 2, "PRK-CAT-FS-4", 4, 200, 340, 32),
        ("Practik Cat Indoor", 2, "PRK-CAT-IN-4", 4, 190, 320, 34),
        ("Practik Kitten Курка", 2, "PRK-KIT-CH-2", 2, 120, 210, 36),
        ("Practik Cat Курка (Мін)", 2, "PRK-CAT-CH-1", 1, 55, 95, 33),
        ("Practik Cat Стерил", 2, "PRK-CAT-ST-4", 4, 195, 330, 34),
        # Вологий корм для собак
        ("Practik Паучі Собак Курка 100г", 3, "PRK-WD-CH-100", 0.1, 15, 28, 38),
        ("Practik Паучі Собак Ягня 100г", 3, "PRK-WD-LM-100", 0.1, 16, 30, 36),
        ("Practik Консерва Собак 400г", 3, "PRK-WD-CN-400", 0.4, 42, 72, 35),
        # Вологий корм для котів
        ("Practik Паучі Кіт Курка 85г", 4, "PRK-WC-CH-85", 0.085, 12, 22, 40),
        ("Practik Паучі Кіт Тунець 85г", 4, "PRK-WC-TN-85", 0.085, 14, 25, 38),
        ("Practik Паучі Кіт Лосось 85г", 4, "PRK-WC-SL-85", 0.085, 13, 24, 39),
        ("Practik Консерва Кіт 200г", 4, "PRK-WC-CN-200", 0.2, 28, 48, 37),
        # Ласощі
        ("Practik Палички Курка", 5, "PRK-TR-CH-100", 0.1, 25, 45, 42),
        ("Practik Палички Яловичина", 5, "PRK-TR-BF-100", 0.1, 28, 50, 40),
        ("Practik Снеки Курка", 5, "PRK-TR-SN-80", 0.08, 20, 38, 44),
        ("Practik Дентал Стік", 5, "PRK-TR-DN-150", 0.15, 30, 55, 42),
        # Спеціалізований корм
        ("Practik Гіпоалергенний Собаки", 6, "PRK-SP-HA-10", 10, 420, 720, 28),
        ("Practik Діабет Контроль Кіт", 6, "PRK-SP-DC-4", 4, 260, 450, 26),
        ("Practik Уролог Кіт", 6, "PRK-SP-UR-4", 4, 240, 420, 28),
        ("Practik Дерма Собаки", 6, "PRK-SP-DM-10", 10, 400, 680, 30),
        ("Practik Mobility Собаки", 6, "PRK-SP-MB-10", 10, 380, 650, 32),
        # Recently launched
        ("Practik Grain Free Качка", 1, "PRK-GF-DK-10", 10, 450, 750, 30),
        ("Practik Cat Grain Free Індичка", 2, "PRK-CGF-TK-4", 4, 230, 390, 28),
        ("Practik Bio Органік Собаки", 1, "PRK-BIO-OG-10", 10, 500, 850, 25),
        ("Practik Паучі Мікс Кіт 12шт", 4, "PRK-WC-MX-12", 1.02, 140, 240, 36),
        ("Practik Puppy Starter", 1, "PRK-PUP-ST-5", 5, 200, 340, 34),
    ]

    products = []
    today = date.today()
    for i, (name, cat_id, sku, weight, cost, price, margin) in enumerate(products_data):
        # Last 5 products are "new" (launched in last 10 days)
        if i >= len(products_data) - 5:
            launch = today - timedelta(days=random.randint(3, 12))
            status = "new"
        else:
            launch = today - timedelta(days=random.randint(60, 400))
            status = "active"

        p = Product(
            name=name,
            category_id=cat_id,
            sku=sku,
            weight_kg=weight,
            launch_date=launch,
            status=status,
            target_margin_pct=margin,
            current_cost_price=Decimal(str(cost)),
            recommended_sale_price=Decimal(str(price)),
        )
        db.add(p)
        products.append(p)

    db.flush()
    return products


def seed_customers(db: Session) -> list:
    customers_data = [
        ("ТОВ ЗооМаркет", "Київ", "wholesale", "b2b"),
        ("ФОП Петренко О.В.", "Львів", "wholesale", "b2b"),
        ("Мережа PetCity", "Харків", "retail", "b2b"),
        ("Тваринний світ", "Одеса", "retail", "b2b"),
        ("ВауПет Онлайн", "Київ", "online", "b2b"),
        ("Розетка Маркет", "Київ", "marketplace", "b2b"),
        ("Prom.ua Зоотовари", "Київ", "marketplace", "b2b"),
        ("ЗооЛабіринт", "Дніпро", "retail", "b2b"),
        ("ФОП Коваленко І.М.", "Вінниця", "wholesale", "b2b"),
        ("Happy Paw Мережа", "Запоріжжя", "retail", "b2b"),
        ("ТОВ АгроЗоо", "Полтава", "wholesale", "b2b"),
        ("Інтернет-магазин PetShop", "Київ", "online", "b2b"),
        ("Базар домашніх тварин", "Одеса", "online", "b2b"),
        ("ФОП Сидоренко А.П.", "Чернігів", "wholesale", "b2b"),
        ("ZooUkraine", "Львів", "marketplace", "b2b"),
    ]
    customers = []
    for name, region, channel, ctype in customers_data:
        c = Customer(name=name, region=region, channel=channel, customer_type=ctype)
        db.add(c)
        customers.append(c)
    db.flush()
    return customers


def seed_managers(db: Session) -> list:
    managers_data = [
        ("Олена Бондаренко", "Продажі"),
        ("Максим Ткаченко", "Продажі"),
        ("Анна Шевченко", "Продажі"),
        ("Дмитро Мельник", "Продажі"),
        ("Ірина Кравченко", "Маркетинг"),
    ]
    managers = []
    for name, dept in managers_data:
        m = Manager(name=name, department=dept)
        db.add(m)
        managers.append(m)
    db.flush()
    return managers


def seed_cost_history(db: Session, products: list):
    today = date.today()
    for p in products:
        # Cost 90 days ago (slightly different)
        old_cost = float(p.current_cost_price) * random.uniform(0.9, 1.05)
        db.add(CostPriceHistory(
            product_id=p.id,
            effective_from=today - timedelta(days=90),
            effective_to=today - timedelta(days=30),
            cost_price=Decimal(str(round(old_cost, 2))),
            source="ERP Import"
        ))
        # Current cost
        db.add(CostPriceHistory(
            product_id=p.id,
            effective_from=today - timedelta(days=30),
            effective_to=None,
            cost_price=p.current_cost_price,
            source="ERP Import"
        ))
    db.flush()


def seed_sales(db: Session, products: list, customers: list, managers: list):
    """Generate 90 days of realistic sales data."""
    today = date.today()
    order_num = 10000
    random.seed(42)

    # Product popularity weights (some sell more than others)
    popularity = {}
    for i, p in enumerate(products):
        if p.status == "new":
            popularity[p.id] = random.uniform(0.3, 0.8)
        elif p.category_id in (1, 2):  # dry food = most popular
            popularity[p.id] = random.uniform(1.0, 3.0)
        elif p.category_id in (3, 4):  # wet food
            popularity[p.id] = random.uniform(0.5, 1.5)
        elif p.category_id == 5:  # treats
            popularity[p.id] = random.uniform(0.4, 1.0)
        else:  # specialized
            popularity[p.id] = random.uniform(0.2, 0.6)

    for day_offset in range(90, -1, -1):
        order_date = today - timedelta(days=day_offset)
        
        # Skip some sundays (fewer sales)
        if order_date.weekday() == 6 and random.random() < 0.4:
            continue

        # 5-20 orders per day
        day_multiplier = 1.0
        if order_date.weekday() in (0, 4):  # Mon, Fri busier
            day_multiplier = 1.3
        if order_date.weekday() == 6:
            day_multiplier = 0.5

        n_orders = int(random.gauss(12, 4) * day_multiplier)
        n_orders = max(3, min(25, n_orders))

        for _ in range(n_orders):
            order_num += 1
            customer = random.choice(customers)
            manager = random.choice(managers[:4])  # only sales managers

            order = SalesOrder(
                order_number=f"ORD-{order_num}",
                order_date=order_date,
                customer_id=customer.id,
                manager_id=manager.id,
                channel=customer.channel,
                status="completed" if random.random() < 0.92 else random.choice(["pending", "cancelled"]),
                payment_status="paid" if random.random() < 0.85 else random.choice(["pending", "partial", "overdue"]),
                shipping_status="delivered" if random.random() < 0.88 else random.choice(["pending", "shipped"]),
            )
            db.add(order)
            db.flush()

            # 1-5 items per order
            n_items = random.choices([1, 2, 3, 4, 5], weights=[30, 35, 20, 10, 5])[0]
            chosen_products = random.choices(
                products,
                weights=[popularity.get(p.id, 1.0) for p in products],
                k=n_items
            )
            # Remove duplicates
            seen = set()
            unique_products = []
            for p in chosen_products:
                if p.id not in seen:
                    seen.add(p.id)
                    unique_products.append(p)

            order_total = Decimal("0")
            for prod in unique_products:
                qty = random.choices(
                    [1, 2, 3, 5, 10, 20],
                    weights=[20, 30, 20, 15, 10, 5]
                )[0]

                unit_price = float(prod.recommended_sale_price)
                # Price variation ±8%
                unit_price *= random.uniform(0.92, 1.08)
                unit_price = round(unit_price, 2)

                # Discount logic
                discount_pct = 0
                is_promo = False
                promo_type = None

                roll = random.random()
                if roll < 0.03:  # 3% blogger/promo
                    discount_pct = random.choice([50, 80, 100])
                    is_promo = True
                    promo_type = random.choice(["blogger", "gift", "sample", "marketing"])
                elif roll < 0.08:  # 5% big discount
                    discount_pct = random.uniform(15, 30)
                elif roll < 0.25:  # 17% normal discount
                    discount_pct = random.uniform(3, 12)

                discount_amount = round(unit_price * qty * discount_pct / 100, 2)
                final = round(unit_price * qty - discount_amount, 2)

                cost_at_sale = float(prod.current_cost_price)
                # Slight cost variation
                cost_at_sale *= random.uniform(0.97, 1.03)
                cost_at_sale = round(cost_at_sale, 2)

                item = SalesOrderItem(
                    order_id=order.id,
                    product_id=prod.id,
                    quantity=qty,
                    unit_price=Decimal(str(unit_price)),
                    discount_pct=round(discount_pct, 1),
                    discount_amount=Decimal(str(discount_amount)),
                    final_price=Decimal(str(max(final, 0))),
                    cost_price_at_sale=Decimal(str(cost_at_sale)),
                    is_promo=is_promo,
                    promo_type=promo_type,
                )
                db.add(item)
                order_total += Decimal(str(max(final, 0)))

                # ~2% returns
                if random.random() < 0.02 and order.status == "completed":
                    db.add(Return(
                        order_item_id=item.id if hasattr(item, 'id') and item.id else None,
                        return_date=order_date + timedelta(days=random.randint(1, 14)),
                        quantity=min(qty, random.randint(1, 2)),
                        reason=random.choice([
                            "Пошкоджена упаковка",
                            "Невідповідність замовленню",
                            "Тварина не їсть",
                            "Прострочений термін",
                            "Зміна рішення клієнтом",
                        ]),
                        return_type=random.choice(["return", "complaint", "compensation"]),
                        amount=Decimal(str(round(final * 0.5, 2))) if random.random() < 0.5 else Decimal(str(final)),
                    ))

            order.total_amount = order_total

    db.flush()


def seed_dashboard_config(db: Session):
    """Create widget-driven dashboard configuration."""
    # Main dashboard
    dash = Dashboard(
        slug="product-analytics",
        title="Аналітика товарів",
        description="Щоденний контроль продажів і маржинальності по товарах",
        icon="📊",
        sort_order=1
    )
    db.add(dash)
    db.flush()

    # Single tab for MVP
    tab = DashboardTab(
        dashboard_id=dash.id,
        slug="overview",
        title="Огляд",
        sort_order=1
    )
    db.add(tab)
    db.flush()

    # Widgets
    widgets = [
        # Row 0: KPI cards
        Widget(tab_id=tab.id, widget_type="kpi_card", title="Виторг MTD",
               data_source="revenue_mtd", config_json={"format": "currency", "comparison": "prev_period", "icon": "💰"},
               size="sm", sort_order=1, row=0, col=0),
        Widget(tab_id=tab.id, widget_type="kpi_card", title="Валова маржа %",
               data_source="gross_margin_pct", config_json={"format": "percent", "comparison": "prev_period", "icon": "📈"},
               size="sm", sort_order=2, row=0, col=1),
        Widget(tab_id=tab.id, widget_type="kpi_card", title="Валова маржа ₴",
               data_source="gross_margin_amount", config_json={"format": "currency", "comparison": "prev_period", "icon": "💵"},
               size="sm", sort_order=3, row=0, col=2),
        Widget(tab_id=tab.id, widget_type="kpi_card", title="Обсяг продажів",
               data_source="sales_volume", config_json={"format": "number", "suffix": "кг", "comparison": "prev_period", "icon": "📦"},
               size="sm", sort_order=4, row=0, col=3),
        Widget(tab_id=tab.id, widget_type="kpi_card", title="К-ть замовлень",
               data_source="order_count", config_json={"format": "number", "suffix": "шт", "comparison": "prev_period", "icon": "🛒"},
               size="sm", sort_order=5, row=0, col=4),
        Widget(tab_id=tab.id, widget_type="kpi_card", title="Повернення %",
               data_source="returns_pct", config_json={"format": "percent", "comparison": "prev_period", "icon": "↩️", "inverse": True},
               size="sm", sort_order=6, row=0, col=5),

        # Row 1: Charts
        Widget(tab_id=tab.id, widget_type="time_series", title="Виторг по днях",
               data_source="revenue_daily", config_json={"chart_type": "area", "color": "#2ECC71"},
               size="lg", sort_order=7, row=1, col=0),
        Widget(tab_id=tab.id, widget_type="time_series", title="Маржинальність по днях",
               data_source="margin_daily", config_json={"chart_type": "line", "color": "#3498DB", "format": "percent"},
               size="md", sort_order=8, row=1, col=1),

        # Row 2: Top charts + alerts
        Widget(tab_id=tab.id, widget_type="bar_chart", title="Топ-5 SKU по виручці",
               data_source="top_products", config_json={"orientation": "horizontal", "color": "#2ECC71", "limit": 5},
               size="md", sort_order=9, row=2, col=0),
        Widget(tab_id=tab.id, widget_type="alert_panel", title="🔔 Алерти",
               data_source="alerts", config_json={},
               size="md", sort_order=10, row=2, col=1),

        # Row 3: Main product table
        Widget(tab_id=tab.id, widget_type="table", title="Всі товари",
               data_source="products_table",
               config_json={
                   "columns": ["name", "category", "revenue", "margin_pct", "margin_amount",
                               "quantity", "avg_price", "delta_revenue", "delta_margin", "status", "ai_comment"],
                   "sortable": True, "filterable": True, "clickable": True
               },
               size="full", sort_order=11, row=3, col=0),

        # Row 4: Customers + AI
        Widget(tab_id=tab.id, widget_type="table", title="Топ-5 клієнтів",
               data_source="top_customers",
               config_json={"columns": ["name", "revenue", "orders", "margin_pct"], "limit": 5},
               size="md", sort_order=12, row=4, col=0),
        Widget(tab_id=tab.id, widget_type="ai_panel", title="🤖 AI Інсайти",
               data_source="ai_insights",
               config_json={"show_chat": True, "max_insights": 3, "max_risks": 3, "max_recommendations": 3},
               size="lg", sort_order=13, row=4, col=1),
    ]
    db.add_all(widgets)
    db.flush()


def seed_metric_definitions(db: Session):
    metrics = [
        MetricDefinition(code="revenue_mtd", name="Revenue MTD", name_ua="Виторг MTD",
                         formula="SUM(final_price) WHERE status!='cancelled' AND order_date IN current_month",
                         unit="₴", grain="monthly", category="sales"),
        MetricDefinition(code="gross_margin_pct", name="Gross Margin %", name_ua="Валова маржа %",
                         formula="(revenue - COGS) / revenue * 100, COGS = SUM(cost_price_at_sale * quantity)",
                         unit="%", grain="monthly", category="profitability"),
        MetricDefinition(code="gross_margin_amount", name="Gross Margin Amount", name_ua="Валова маржа сума",
                         formula="revenue - COGS", unit="₴", grain="monthly", category="profitability"),
        MetricDefinition(code="sales_volume", name="Sales Volume", name_ua="Обсяг продажів",
                         formula="SUM(quantity) WHERE status='completed'", unit="кг", grain="monthly", category="sales"),
        MetricDefinition(code="order_count", name="Order Count", name_ua="К-ть замовлень",
                         formula="COUNT(DISTINCT order_id) WHERE status!='cancelled'", unit="шт", grain="monthly", category="sales"),
        MetricDefinition(code="avg_sale_price", name="Average Sale Price", name_ua="Середня ціна",
                         formula="revenue / sales_volume", unit="₴/кг", grain="daily", category="sales"),
        MetricDefinition(code="returns_pct", name="Returns %", name_ua="Повернення %",
                         formula="returned_qty / sold_qty * 100", unit="%", grain="monthly", category="quality"),
        MetricDefinition(code="margin_delta", name="Margin Delta", name_ua="Зміна маржі",
                         formula="current_margin_pct - prev_period_margin_pct", unit="п.п.", grain="daily", category="profitability"),
        MetricDefinition(code="revenue_delta_pct", name="Revenue Delta %", name_ua="Зміна виторгу %",
                         formula="(current_revenue - prev_revenue) / prev_revenue * 100", unit="%", grain="daily", category="sales"),
        MetricDefinition(code="cost_variance", name="Cost Variance", name_ua="Відхилення собівартості",
                         formula="actual_cost - expected_cost per SKU", unit="₴", grain="daily", category="procurement"),
    ]
    db.add_all(metrics)
    db.flush()


def seed_feature_flags(db: Session):
    flags = [
        FeatureFlag(feature_key="ai_insights", is_enabled=True, description="AI інсайти на дашборді"),
        FeatureFlag(feature_key="ai_chat", is_enabled=True, description="AI чат для запитів"),
        FeatureFlag(feature_key="product_detail", is_enabled=True, description="Детальна сторінка товару"),
        FeatureFlag(feature_key="anomaly_detection", is_enabled=True, description="Автоматичне виявлення аномалій"),
        FeatureFlag(feature_key="export_csv", is_enabled=False, description="Експорт в CSV (в розробці)"),
        FeatureFlag(feature_key="forecast", is_enabled=False, description="Прогнозування продажів (Phase 2)"),
        FeatureFlag(feature_key="multi_ai_consensus", is_enabled=False, description="Мульти-AI консенсус (Phase 2)"),
    ]
    db.add_all(flags)
    db.flush()


def seed_ai_config(db: Session):
    configs = [
        AIProviderConfig(
            provider_name="openai",
            display_name="OpenAI GPT-4",
            api_key_env="OPENAI_API_KEY",
            model_name="gpt-4o",
            is_active=True,
            priority=1,
            max_tokens=2000,
            temperature=0.3
        ),
        AIProviderConfig(
            provider_name="mock",
            display_name="Mock Provider (Dev)",
            api_key_env="MOCK_KEY",
            model_name="mock-v1",
            is_active=True,
            priority=99,
            max_tokens=2000,
            temperature=0
        ),
    ]
    db.add_all(configs)
    db.flush()


def seed_ai_insights(db: Session, products: list):
    """Pre-seed some demo AI insights."""
    insights = [
        AIInsight(
            insight_type="anomaly",
            severity="warning",
            title="Різке падіння маржі по Practik Adult Курка",
            body="Маржинальність по товару PRK-DOG-CH-10 впала з 32% до 18% за останні 3 дні. "
                 "Основна причина — зростання кількості замовлень зі знижкою >15%. "
                 "4 замовлення мають нетипову знижку 25-30%. "
                 "Рекомендація: перевірити, чи санкціоновані ці знижки менеджерами.",
            related_product_id=products[0].id if products else None,
            related_metric="gross_margin_pct",
            confidence=0.82,
        ),
        AIInsight(
            insight_type="risk",
            severity="critical",
            title="Підозра на помилкове оформлення",
            body="По товару PRK-CAT-FS-4 зафіксовано 2 відвантаження без комерційної логіки: "
                 "знижка 100%, promo_type не вказаний. Це може бути помилка оформлення. "
                 "Перевірте замовлення ORD-10234 та ORD-10567.",
            related_product_id=products[9].id if len(products) > 9 else None,
            related_metric="gross_margin_pct",
            confidence=0.75,
        ),
        AIInsight(
            insight_type="recommendation",
            severity="info",
            title="Зростання попиту на ласощі",
            body="Категорія 'Ласощі' показує стабільне зростання +12% за останній місяць. "
                 "Найкращі результати у Practik Палички Курка та Дентал Стік. "
                 "Рекомендація: розглянути розширення асортименту ласощів та збільшення запасів.",
            related_metric="sales_volume",
            confidence=0.88,
        ),
        AIInsight(
            insight_type="insight",
            severity="info",
            title="Канал Marketplace обганяє Wholesale",
            body="Вперше за квартал продажі через маркетплейси (Розетка, Prom.ua) перевищили "
                 "оптові продажі на 8%. При цьому маржинальність через маркетплейси на 3 п.п. вище. "
                 "Це тренд, який варто відстежувати і, можливо, коригувати стратегію дистрибуції.",
            related_metric="revenue_mtd",
            confidence=0.79,
        ),
        AIInsight(
            insight_type="risk",
            severity="warning",
            title="Новий товар Grain Free Качка — повільний старт",
            body="Товар PRK-GF-DK-10 запущено 7 днів тому. Порівняно з аналогічними запусками, "
                 "продажі на 35% нижче очікуваного. Можливі причини: недостатня промо-підтримка, "
                 "висока ціна відносно звичайного сухого корму. "
                 "Рекомендація: перевірити видимість на маркетплейсах та розглянути ввідну акцію.",
            related_product_id=products[-5].id if len(products) >= 5 else None,
            related_metric="sales_volume",
            confidence=0.71,
        ),
        AIInsight(
            insight_type="recommendation",
            severity="info",
            title="Оптимізація знижок по менеджеру Ткаченко М.",
            body="Менеджер Максим Ткаченко застосовує знижки в 2.3 рази частіше за середнє по команді. "
                 "Середня знижка: 14.2% проти 6.8% у інших. "
                 "Це вплинуло на маржу по 12 SKU. "
                 "Рекомендація: провести review політики знижок з цим менеджером.",
            related_metric="gross_margin_pct",
            confidence=0.85,
        ),
    ]
    db.add_all(insights)
    db.flush()
