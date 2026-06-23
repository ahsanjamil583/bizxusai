from pydantic import BaseModel, Field


class LaunchProfileRequest(BaseModel):
    profileCode: str = Field(default="ai_ordering", max_length=40)
    autoUpgradePlan: bool = True


class LaunchFinalizeRequest(BaseModel):
    publishWebsite: bool = True
    allowWarnings: bool = True
