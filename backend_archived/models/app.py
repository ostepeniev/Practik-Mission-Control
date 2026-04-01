"""App schema: users, dashboards, widgets, feature flags, metrics."""
from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime, Text, JSON, Float, func
)
from backend.database import Base


class User(Base):
    __tablename__ = "app_users"

    id = Column(Integer, primary_key=True)
    username = Column(String(100), unique=True, nullable=False)
    password_hash = Column(String(300), nullable=False)
    display_name = Column(String(200), nullable=False)
    role = Column(String(50), nullable=False, default="owner")
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())


class Dashboard(Base):
    __tablename__ = "app_dashboards"

    id = Column(Integer, primary_key=True)
    slug = Column(String(100), unique=True, nullable=False)
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    icon = Column(String(50), nullable=True)
    sort_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)


class DashboardTab(Base):
    __tablename__ = "app_dashboard_tabs"

    id = Column(Integer, primary_key=True)
    dashboard_id = Column(Integer, nullable=False)
    slug = Column(String(100), nullable=False)
    title = Column(String(200), nullable=False)
    sort_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)


class Widget(Base):
    __tablename__ = "app_widgets"

    id = Column(Integer, primary_key=True)
    tab_id = Column(Integer, nullable=False)
    widget_type = Column(String(50), nullable=False)
    title = Column(String(200), nullable=False)
    subtitle = Column(String(300), nullable=True)
    data_source = Column(String(200), nullable=False)
    config_json = Column(JSON, nullable=True)
    size = Column(String(20), default="md")
    sort_order = Column(Integer, default=0)
    is_visible_owner = Column(Boolean, default=True)
    is_active = Column(Boolean, default=True)
    row = Column(Integer, default=0)
    col = Column(Integer, default=0)


class FeatureFlag(Base):
    __tablename__ = "app_feature_flags"

    id = Column(Integer, primary_key=True)
    feature_key = Column(String(100), unique=True, nullable=False)
    is_enabled = Column(Boolean, default=False)
    description = Column(Text, nullable=True)


class MetricDefinition(Base):
    __tablename__ = "app_metric_definitions"

    id = Column(Integer, primary_key=True)
    code = Column(String(100), unique=True, nullable=False)
    name = Column(String(200), nullable=False)
    name_ua = Column(String(200), nullable=True)
    description = Column(Text, nullable=True)
    formula = Column(Text, nullable=True)
    unit = Column(String(50), nullable=True)
    grain = Column(String(50), nullable=True)
    category = Column(String(100), nullable=True)
    owner = Column(String(100), nullable=True)
    refresh_interval_min = Column(Integer, default=15)
