"""AI schema: runs, insights, provider config."""
from sqlalchemy import (
    Column, Integer, String, Float, DateTime, Text, Boolean, JSON, func
)
from backend.database import Base


class AIRun(Base):
    __tablename__ = "ai_runs"

    id = Column(Integer, primary_key=True)
    provider = Column(String(50), nullable=False)
    model = Column(String(100), nullable=False)
    task_type = Column(String(50), nullable=False)
    input_summary = Column(Text, nullable=True)
    output_summary = Column(Text, nullable=True)
    tokens_in = Column(Integer, default=0)
    tokens_out = Column(Integer, default=0)
    cost_usd = Column(Float, default=0)
    latency_ms = Column(Integer, default=0)
    status = Column(String(30), default="success")
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())


class AIInsight(Base):
    __tablename__ = "ai_insights"

    id = Column(Integer, primary_key=True)
    run_id = Column(Integer, nullable=True)
    insight_type = Column(String(30), nullable=False)
    severity = Column(String(20), default="info")
    title = Column(String(300), nullable=False)
    body = Column(Text, nullable=False)
    related_product_id = Column(Integer, nullable=True)
    related_metric = Column(String(100), nullable=True)
    confidence = Column(Float, nullable=True)
    is_read = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())


class AIProviderConfig(Base):
    __tablename__ = "ai_provider_config"

    id = Column(Integer, primary_key=True)
    provider_name = Column(String(50), unique=True, nullable=False)
    display_name = Column(String(100), nullable=True)
    api_key_env = Column(String(100), nullable=False)
    model_name = Column(String(100), nullable=False)
    is_active = Column(Boolean, default=True)
    priority = Column(Integer, default=10)
    max_tokens = Column(Integer, default=2000)
    temperature = Column(Float, default=0.3)
