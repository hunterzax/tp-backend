import { Inject, Injectable } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { Observable, firstValueFrom } from 'rxjs';


interface FileService {
  UploadFile(data: { file_content: Uint8Array }): Observable<{ json_data: string }>;
  UploadFileTemp(data: { file_content: Uint8Array }): Observable<{ json_data: string }>;
  UploadFileMultiSheetTemp(data: { file_content: Uint8Array }): Observable<{ json_data: string }>;
}


@Injectable()
export class FileUploadService {
  private fileService: FileService;

  constructor(@Inject('FILE_SERVICE') private client: ClientGrpc) {}

  onModuleInit() {
    this.fileService = this.client.getService<FileService>('FileService');
  }

  async uploadFile(fileBuffer: Buffer) {
    console.log('File buffer size before sending to gRPC:', fileBuffer.length);

    if (fileBuffer.length === 0) {
      throw new Error('File buffer is empty');
    }

    // ใช้ Uint8Array.from() เพื่อแปลง buffer
    const response = await firstValueFrom(
      this.fileService.UploadFile({
        file_content: Uint8Array.from(fileBuffer),
      }),
    );

    return response;
  }
  
  async uploadFileTemp(fileBuffer: Buffer) {
    console.log('File buffer size before sending to gRPC:', fileBuffer.length);

    if (fileBuffer.length === 0) {
      throw new Error('File buffer is empty');
    }

    const response = await firstValueFrom(
      this.fileService.UploadFileTemp({ file_content: Uint8Array.from(fileBuffer) }),
    );

    return response;
  }

  async uploadFileTempMultiSheet(fileBuffer: Buffer) {
    console.log('File buffer size before sending to gRPC:', fileBuffer.length);

    if (fileBuffer.length === 0) {
      throw new Error('File buffer is empty');
    }

    const response = await firstValueFrom(
      this.fileService.UploadFileMultiSheetTemp({ file_content: Uint8Array.from(fileBuffer) }),
    );

    return response;
  }
}
