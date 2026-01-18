import FormData from 'form-data';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

import isBetween from 'dayjs/plugin/isBetween'; // นำเข้า plugin isBetween
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore'; // นำเข้า plugin isSameOrBefore
import axios from 'axios';
dayjs.extend(isSameOrBefore); // เปิดใช้งาน plugin isSameOrBefore
dayjs.extend(isBetween); // เปิดใช้งาน plugin isBetween
dayjs.extend(utc);
dayjs.extend(timezone);


export async function uploadFilsTemp(file: any) {
    const data = new FormData();
    data.append('file', file.buffer, file.originalname); // ใช้ buffer ตรง ๆ และกำหนดชื่อไฟล์

    const config = { 
      method: 'post',
      maxBodyLength: Infinity,
      url: `${process.env.GATEWAY_BASE_URL || `https://${process.env.IP_URL}:${process.env.KONG_PORT}`}/files/uploadfile/`,
      // url: `http://${process.env.IP_URL}:8443/files/uploadfile/`,
      // url: `http://${process.env.IP_URL}:4006/uploadfile/`,
      headers: {
        ...data.getHeaders(),
      },
      data: data,
    };

    try {
      // basic safety for configured gateway
      const port = Number(process.env.KONG_PORT);
      if (!Number.isFinite(port) || port <= 0) {
        throw new Error('Invalid KONG_PORT');
      }
      const response = await axios.request(config);
      return response.data; // คืนค่าผลลัพธ์จาก API
    } catch (error) {
      console.error('Upload error:', error.response?.data || error.message);
      throw error; // ส่งข้อผิดพลาดกลับไป
    }
}
