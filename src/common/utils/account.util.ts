import { PrismaService } from 'prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { EmailClientService } from 'src/grpc/email-service.service';
import {
  getTodayEndAdd7,
  getTodayNowAdd7,
  getTodayNowDDMMYYYYDfaultAdd7,
  getTodayStartAdd7,
} from 'src/common/utils/date.util';

dayjs.extend(utc);
dayjs.extend(timezone);

export function generatePassword(length: number): string {
  const lowerCase = 'abcdefghijklmnopqrstuvwxyz';
  const upperCase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const numbers = '0123456789';
  const specialChars = '!@#$%^&*()+-=<>?';

  // รวมอักขระทั้งหมดเข้าด้วยกัน
  const allChars = lowerCase + upperCase + numbers + specialChars;

  // สุ่มรหัสผ่านตามจำนวน length ที่ต้องการ
  let password = '';
  for (let i = 0; i < length; i++) {
    const randomIndex = crypto.randomInt(0, allChars.length);
    password += allChars[randomIndex];
  }

  // ตรวจสอบว่าแต่ละกลุ่มอักขระ (a-z, A-Z, 0-9, อักขระพิเศษ) ถูกใช้ในรหัสผ่าน
  if (!/[a-z]/.test(password)) {
    password += lowerCase[crypto.randomInt(0, lowerCase.length)];
  }
  if (!/[A-Z]/.test(password)) {
    password += upperCase[crypto.randomInt(0, upperCase.length)];
  }
  if (!/[0-9]/.test(password)) {
    password += numbers[crypto.randomInt(0, numbers.length)];
  }
  if (!/[!@#$%^&*()+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    password += specialChars[crypto.randomInt(0, specialChars.length)];
  }

  // สลับตัวอักษรในรหัสผ่านเพื่อความสุ่มที่มากขึ้น
  return shuffle(password).substring(0, length);
}

// ฟังก์ชันสลับตัวอักษร
export function shuffle(password: string): string {
  const array = password.split('');
  for (let i = array.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array.join('');
}

export async function genPass(password: any) {
  const salt = await bcrypt.genSalt();
  const hash = await bcrypt.hash(password, salt);

  const isMatch = await bcrypt.compare(password, hash);

  return {
    hash,
    isMatch,
  };
}

export async function nPassword() {
  const generated = generatePassword(12);
  const hashPassword = await genPass(generated);
  return {
    ...hashPassword,
    password: generated,
  };
}

export async function checkPreDate(date: any): Promise<boolean> {
  const inputDate = dayjs(date);
  if (inputDate.isBefore(getTodayNowAdd7().toDate())) {
    return true;
  } else {
    return false;
  }
}

export async function genTokenReset(jwtService: any, id: any, email: any) {
  const token = await jwtService.signAsync(
    {
      sub: id,
      username: email,
      type: 'access',
    },
    {
      expiresIn: '30m',
    },
  );
  return token;
}
