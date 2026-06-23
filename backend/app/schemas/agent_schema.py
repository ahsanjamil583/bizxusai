from pydantic import BaseModel, Field


class AgentPreviewRequest(BaseModel):
    messageText: str = Field(min_length=1, max_length=2000)
    channel: str = Field(default="owner_preview", max_length=40)
    includeRecentMessages: bool = False
