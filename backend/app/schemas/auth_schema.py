from pydantic import BaseModel, EmailStr, Field


class BusinessRegisterRequest(BaseModel):
    fullName: str = Field(min_length=2, max_length=120)
    phone: str = Field(min_length=7, max_length=30)
    password: str = Field(min_length=6, max_length=128)
    email: EmailStr | None = None


class LoginRequest(BaseModel):
    email: EmailStr | None = None
    password: str = Field(min_length=1, max_length=128)


class RefreshTokenRequest(BaseModel):
    refreshToken: str


class UserPublic(BaseModel):
    id: str
    fullName: str
    email: EmailStr | None = None
    phone: str
    accountType: str
    globalRole: str
    status: str
    isEmailVerified: bool
    isPhoneVerified: bool


class AuthResponse(BaseModel):
    accessToken: str
    refreshToken: str
    tokenType: str = "bearer"
    user: UserPublic
