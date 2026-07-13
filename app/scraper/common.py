import threading


class Common:
    closeThread = threading.Event()
    lock = threading.Lock()

    @classmethod
    def set_close_thread(cls):
        with cls.lock:
            cls.closeThread.set()

    @classmethod
    def close_thread_is_set(cls):
        return cls.closeThread.is_set()

    @classmethod
    def smart_sleep(cls, duration, interval=0.5):
        import time
        elapsed = 0
        while elapsed < duration:
            if cls.close_thread_is_set():
                break
            time.sleep(min(interval, duration - elapsed))
            elapsed += interval
