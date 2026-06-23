import unittest

from fastapi import HTTPException

from app.services.otp_service import (
    hash_otp_code,
    mask_phone,
    normalize_account_type,
    normalize_otp_code,
    normalize_otp_purpose,
    verify_otp_hash,
)


class Phase29PhoneOtpTests(unittest.TestCase):
    def test_normalize_otp_code_keeps_digits_only(self):
        self.assertEqual(normalize_otp_code(" 12-34 56 "), "123456")

    def test_mask_phone_keeps_safe_preview_only(self):
        self.assertEqual(mask_phone("03001234567"), "0300****567")

    def test_hash_round_trip_uses_phone_purpose_and_account_type(self):
        digest = hash_otp_code("03001234567", "123456", "login", "customer")
        self.assertTrue(verify_otp_hash("03001234567", "123456", "login", "customer", digest))
        self.assertFalse(verify_otp_hash("03001234567", "123456", "register", "customer", digest))
        self.assertFalse(verify_otp_hash("03001234567", "000000", "login", "customer", digest))

    def test_invalid_account_type_and_purpose_are_rejected(self):
        with self.assertRaises(HTTPException):
            normalize_account_type("admin")
        with self.assertRaises(HTTPException):
            normalize_otp_purpose("magic")
