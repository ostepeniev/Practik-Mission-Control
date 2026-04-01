"""Core schema: reference data + operational facts."""
from sqlalchemy import (
    Column, Integer, String, Float, Date, DateTime, Boolean,
    ForeignKey, Text, Numeric, func
)
from sqlalchemy.orm import relationship
from backend.database import Base


# ─── Reference / Dimension Tables ────────────────────────────────────────────

class ProductCategory(Base):
    __tablename__ = "core_product_categories"

    id = Column(Integer, primary_key=True)
    name = Column(String(200), nullable=False)
    parent_id = Column(Integer, ForeignKey("core_product_categories.id"), nullable=True)
    
    products = relationship("Product", back_populates="category")


class Product(Base):
    __tablename__ = "core_products"

    id = Column(Integer, primary_key=True)
    name = Column(String(300), nullable=False)
    category_id = Column(Integer, ForeignKey("core_product_categories.id"), nullable=False)
    sku = Column(String(50), unique=True, nullable=False)
    brand = Column(String(100), default="Practik")
    weight_kg = Column(Float, nullable=True)
    launch_date = Column(Date, nullable=True)
    status = Column(String(20), default="active")
    target_margin_pct = Column(Float, default=30.0)
    current_cost_price = Column(Numeric(12, 2), nullable=True)
    recommended_sale_price = Column(Numeric(12, 2), nullable=True)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    category = relationship("ProductCategory", back_populates="products")
    order_items = relationship("SalesOrderItem", back_populates="product")
    cost_history = relationship("CostPriceHistory", back_populates="product")


class Customer(Base):
    __tablename__ = "core_customers"

    id = Column(Integer, primary_key=True)
    name = Column(String(300), nullable=False)
    region = Column(String(100), nullable=True)
    channel = Column(String(50), nullable=True)
    customer_type = Column(String(50), nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    orders = relationship("SalesOrder", back_populates="customer")


class Manager(Base):
    __tablename__ = "core_managers"

    id = Column(Integer, primary_key=True)
    name = Column(String(200), nullable=False)
    department = Column(String(100), nullable=True)
    is_active = Column(Boolean, default=True)

    orders = relationship("SalesOrder", back_populates="manager")


# ─── Operational Fact Tables ─────────────────────────────────────────────────

class SalesOrder(Base):
    __tablename__ = "core_sales_orders"

    id = Column(Integer, primary_key=True)
    order_number = Column(String(50), unique=True, nullable=False)
    order_date = Column(Date, nullable=False)
    customer_id = Column(Integer, ForeignKey("core_customers.id"), nullable=True)
    manager_id = Column(Integer, ForeignKey("core_managers.id"), nullable=True)
    channel = Column(String(50), nullable=True)
    status = Column(String(30), default="completed")
    payment_status = Column(String(30), default="paid")
    shipping_status = Column(String(30), default="shipped")
    total_amount = Column(Numeric(12, 2), default=0)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    customer = relationship("Customer", back_populates="orders")
    manager = relationship("Manager", back_populates="orders")
    items = relationship("SalesOrderItem", back_populates="order")


class SalesOrderItem(Base):
    __tablename__ = "core_sales_order_items"

    id = Column(Integer, primary_key=True)
    order_id = Column(Integer, ForeignKey("core_sales_orders.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("core_products.id"), nullable=False)
    quantity = Column(Float, nullable=False)
    unit_price = Column(Numeric(12, 2), nullable=False)
    discount_pct = Column(Float, default=0)
    discount_amount = Column(Numeric(12, 2), default=0)
    final_price = Column(Numeric(12, 2), nullable=False)
    cost_price_at_sale = Column(Numeric(12, 2), nullable=True)
    is_promo = Column(Boolean, default=False)
    promo_type = Column(String(50), nullable=True)
    notes = Column(Text, nullable=True)

    order = relationship("SalesOrder", back_populates="items")
    product = relationship("Product", back_populates="order_items")
    returns = relationship("Return", back_populates="order_item")


class Return(Base):
    __tablename__ = "core_returns"

    id = Column(Integer, primary_key=True)
    order_item_id = Column(Integer, ForeignKey("core_sales_order_items.id"), nullable=False)
    return_date = Column(Date, nullable=False)
    quantity = Column(Float, nullable=False)
    reason = Column(String(200), nullable=True)
    return_type = Column(String(50), default="return")
    amount = Column(Numeric(12, 2), nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    order_item = relationship("SalesOrderItem", back_populates="returns")


class CostPriceHistory(Base):
    __tablename__ = "core_cost_price_history"

    id = Column(Integer, primary_key=True)
    product_id = Column(Integer, ForeignKey("core_products.id"), nullable=False)
    effective_from = Column(Date, nullable=False)
    effective_to = Column(Date, nullable=True)
    cost_price = Column(Numeric(12, 2), nullable=False)
    source = Column(String(100), nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    product = relationship("Product", back_populates="cost_history")
