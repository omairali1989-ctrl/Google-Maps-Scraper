class Communicator:

    __frontend_object = None
    __backend_object = None

    @classmethod
    def show_message(cls, message):
        if cls.__frontend_object is None:
            print(f"[Communicator] {message}")
            return
        cls.__frontend_object.messageshowing(message)

    @classmethod
    def show_error_message(cls, message, error_code):
        msg = f"{message} Error code is: {error_code}"
        if cls.__frontend_object is None:
            print(f"[Communicator ERROR] {msg}")
            return
        cls.__frontend_object.messageshowing(msg)

    @classmethod
    def set_frontend_object(cls, frontend_object):
        cls.__frontend_object = frontend_object

    @classmethod
    def end_processing(cls):
        if cls.__frontend_object is not None:
            cls.__frontend_object.end_processing()

    @classmethod
    def get_output_format(cls):
        if cls.__frontend_object is None:
            return "excel"
        return cls.__frontend_object.outputFormatValue

    @classmethod
    def set_backend_object(cls, backend_object):
        cls.__backend_object = backend_object

    @classmethod
    def get_search_query(cls):
        if cls.__backend_object is None:
            return ""
        return cls.__backend_object.searchquery
