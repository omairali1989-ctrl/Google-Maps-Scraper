import pytest
import os
import sys
from multiprocessing import Queue

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../')))

from app.web_bridge import JobManager, JobState

def test_job_state_initialization():
    state = JobState("123", "test query", "excel", False)
    assert state.job_id == "123"
    assert state.searchQuery == "test query"
    assert state.outputFormatValue == "excel"
    assert state.is_running is False
    assert state.scraped_count == 0
    assert len(state.messages) == 0

def test_job_state_messageshowing():
    state = JobState("123", "test query", "excel", False)
    
    # Process a log message
    state.messageshowing("test log message")
    assert "test log message" in state.messages
    
    # Process scraped count update
    state.messageshowing("Total locations scrolled: 5")
    assert state.current_query_scrolled == 5
    
    # Process job complete / stop
    state.is_running = True
    state.stop_job()
    assert state.messages[-1] == "Stop request sent to scraper process..."

def test_job_manager_get_job_state():
    manager = JobManager()
    state = JobState("123", "test query", "excel", False)
    manager.active_jobs["123"] = state
    
    retrieved = manager.get_job_state("123")
    assert retrieved == state
    
    unknown = manager.get_job_state("999")
    assert unknown is None
