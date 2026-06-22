from sqlalchemy import Column, Integer, String, DateTime, Boolean, Text
from sqlalchemy.orm import declarative_base
from datetime import datetime

Base = declarative_base()

class EventLog(Base):
    __tablename__ = 'event_logs'
    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=datetime.utcnow)
    category = Column(String(64), nullable=False)
    message = Column(Text, nullable=False)
    details = Column(Text, nullable=True)

class CameraStatus(Base):
    __tablename__ = 'camera_status'
    id = Column(Integer, primary_key=True, index=True)
    connected = Column(Boolean, default=False)
    protocol = Column(String(32), nullable=True)
    last_error = Column(Text, nullable=True)
    last_update = Column(DateTime, default=datetime.utcnow)
