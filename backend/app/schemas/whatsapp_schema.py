from pydantic import BaseModel, Field


class WhatsAppSettingsRequest(BaseModel):
    provider: str = Field(default="mock", pattern="^(mock|meta_cloud)$")
    businessWhatsAppNumber: str = Field(min_length=6, max_length=32)
    displayName: str = Field(default="", max_length=120)
    phoneNumberId: str = Field(default="", max_length=120)
    accessToken: str = Field(default="", max_length=1000)
    apiVersion: str = Field(default="v21.0", max_length=20)
    autoReplyEnabled: bool = True
    handoffEnabled: bool = True
    handoffKeywords: list[str] = Field(default_factory=lambda: ["human", "agent", "admin", "owner"])
    welcomeMessage: str = Field(
        default="Assalam o Alaikum! Main BizXus AI assistant hoon. Aap products, prices, timing ya order ke bare mein pooch sakte hain.",
        max_length=500,
    )


class WhatsAppMockInboundRequest(BaseModel):
    customerPhone: str = Field(min_length=6, max_length=32)
    customerName: str = Field(default="WhatsApp Customer", max_length=120)
    messageText: str = Field(min_length=1, max_length=1000)
    providerMessageId: str = Field(default="", max_length=180)


class WhatsAppOutboundRequest(BaseModel):
    toPhone: str = Field(min_length=6, max_length=32)
    messageText: str = Field(min_length=1, max_length=1000)
