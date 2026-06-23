from pydantic import BaseModel, Field


class PaymentSettingsRequest(BaseModel):
    codEnabled: bool = True
    manualEnabled: bool = True
    jazzCashEnabled: bool = False
    easyPaisaEnabled: bool = False
    jazzCashNumber: str = Field(default="", max_length=40)
    easyPaisaNumber: str = Field(default="", max_length=40)
    bankAccountTitle: str = Field(default="", max_length=120)
    bankAccountNumber: str = Field(default="", max_length=80)
    defaultMethod: str = "cod"
    customerInstructions: str = Field(default="", max_length=1000)


class PaymentRecordRequest(BaseModel):
    amount: float = Field(gt=0)
    method: str = "cod"
    status: str = "completed"
    referenceNumber: str = Field(default="", max_length=120)
    notes: str = Field(default="", max_length=1000)


class PaymentRefundRequest(BaseModel):
    amount: float = Field(gt=0)
    method: str = "manual"
    referenceNumber: str = Field(default="", max_length=120)
    notes: str = Field(default="", max_length=1000)
