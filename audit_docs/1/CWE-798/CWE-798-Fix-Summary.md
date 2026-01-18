### CWE-798: Use of Hard-coded Credentials — Fix Summary

#### Overview
พบจุดเสี่ยงการใช้ค่า Credentials/Secrets แบบ hard-code หลายตำแหน่ง ซึ่งเข้าข่าย CWE-798 ทำให้เกิดความเสี่ยงด้านการรั่วไหลของข้อมูลลับและการเข้าถึงระบบโดยไม่ได้รับอนุญาต จึงได้ปรับปรุงให้ดึงค่าลับจาก environment variables ผ่าน ConfigService แทน และตัดค่า default ที่ไม่ปลอดภัยออก

#### Affected Files (ก่อนแก้ไข)
- `src/encrypt-response.middleware.ts`: มี `secretKey`, `iv` ถูก hard-code
- `src/common/utils/account.util.ts`: มีรหัสผ่านตัวอย่างที่ถูก hard-code ใน `nPassword()`
- `src/auth/auth.service.ts`: มี in-memory admin และการสร้าง hash ด้วยรหัสผ่านที่ถูก hard-code ใน `genPass()`
- `src/tariff/tariff.service.ts`: ใช้ Bearer token แบบ hard-code ใน header ของคำขอ
- `scripts/fetch-env-from-vault.js`: มีค่า VAULT ที่เป็นค่าคงที่ (ADDR/TOKEN/SECRET_PATH) ที่ไม่ปลอดภัย
- `src/auth/auth.module.ts` และ `src/auth/constants.ts`: ใช้ JWT secret แบบค่าคงที่

#### Remediation Summary (หลังแก้ไข)
- `src/encrypt-response.middleware.ts`
  - อ่าน `ENCRYPT_SECRET_KEY` (32 ตัวอักษร) และ `ENCRYPT_IV` (16 ตัวอักษร) จาก env ผ่าน `ConfigService` และตรวจสอบความยาวก่อนใช้งาน

- `src/common/utils/account.util.ts`
  - ลบรหัสผ่านที่ hard-code ออก เปลี่ยน `nPassword()` ให้สุ่มรหัสผ่านและคืนค่า `{ hash, isMatch, password }`

- `src/auth/auth.service.ts`
  - กำหนด in-memory admin ให้รับค่าจาก env: `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` (bcrypt)
  - ปรับ `genPass()` ให้สุ่มรหัสผ่าน 12 ตัวอักษร แทนค่าคงที่

- `src/tariff/tariff.service.ts`
  - Inject `ConfigService` และใช้ `IN_APP_BEARER_TOKEN` จาก env แทนค่า Bearer token คงที่ใน header

- `scripts/fetch-env-from-vault.js`
  - ตัดค่าดีฟอลต์ที่ไม่ปลอดภัยสำหรับ `VAULT_ADDR`, `VAULT_TOKEN`, `VAULT_SECRET_PATH` บังคับให้รับจาก environment เท่านั้น พร้อม error หากไม่ตั้งค่า

- `src/auth/auth.module.ts`
  - เปลี่ยนเป็น `JwtModule.registerAsync` เพื่ออ่าน `JWT_SECRET`, `JWT_EXPIRES_IN` ผ่าน `ConfigService`

- `src/auth/constants.ts`
  - เพิ่มฟังก์ชันช่วยอ่าน secret จาก env และคง export เดิมไว้เพื่อ backward compatibility (ใช้ env เป็นค่าเริ่ม)

#### Required Environment Variables
- Authentication
  - `JWT_SECRET` (จำเป็น)
  - `JWT_EXPIRES_IN` (เช่น `300s`)
  - `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` (bcrypt hash)
- Encryption
  - `ENCRYPT_SECRET_KEY` (ยาว 32 ตัวอักษร)
  - `ENCRYPT_IV` (ยาว 16 ตัวอักษร)
- Tariff external call
  - `IN_APP_BEARER_TOKEN`
- Vault fetch script
  - `VAULT_ADDR`, `VAULT_TOKEN`, `VAULT_SECRET_PATH`

หมายเหตุ: ต้องกำหนด `.env` ผ่าน pipeline/secret manager เท่านั้น ไม่ควร commit ลง repo

#### Risk Reduction
- ลดความเสี่ยงการรั่วไหลของ credential จาก source code และ artifact (dist, logs)
- รองรับ rotation ของ secrets ได้สะดวกผ่านการเปลี่ยนค่า env โดยไม่ต้องแก้โค้ด
- ปิดช่องทางการโจมตีจาก token/secret ที่หลุดในประวัติ git หรือไฟล์ build

#### Verification Checklist
1) Static checks
   - ค้นหาใน repo ว่ายังมี pattern ที่เสี่ยงหรือไม่ เช่น `Authorization: 'Bearer`, `secret = '`, `ENCRYPT_.*=' แบบ hard-code
2) Runtime
   - ตั้งค่า env ตามรายการข้างต้นและรันแอปให้ผ่าน โดยไม่มี error เรื่องคีย์เข้ารหัส/secret ไม่ครบ
3) Auth & Crypto
   - เรียก endpoint ที่เข้ารหัส response เพื่อตรวจสอบว่าทำงานได้และใช้คีย์จาก env จริง
   - ทดสอบ login ด้วย admin จาก `ADMIN_USERNAME` + รหัสผ่านที่ตรงกับ `ADMIN_PASSWORD_HASH`
4) Tariff integration
   - ทดสอบ flow ที่เรียก in-app notification แล้ว header มี `Authorization: Bearer <IN_APP_BEARER_TOKEN>`
5) Vault script
   - รัน `scripts/fetch-env-from-vault.js` โดยตั้งค่า VAULT_* ผ่าน env และตรวจสอบว่าไม่มีค่า default ถูกใช้

#### Residual Risk / Follow-ups
- ต้องมี secret management ที่ปลอดภัยใน CI/CD (เช่น Vault, Secret Manager) และจำกัดสิทธิ์การเข้าถึง
- ควรเพิ่ม secret rotation policy และ monitoring สำหรับการใช้งาน token/keys

#### Status
- Applied and lint-checked with no errors. All identified CWE-798 occurrences fixed.


