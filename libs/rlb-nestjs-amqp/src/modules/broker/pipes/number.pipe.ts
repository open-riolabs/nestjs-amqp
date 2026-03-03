import { PipeTransform } from "@nestjs/common";

export class NumberPipe implements PipeTransform<string, number> {
  transform(value: string): number {
    return Number(value);
  }
}