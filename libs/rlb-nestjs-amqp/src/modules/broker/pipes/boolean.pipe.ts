import { PipeTransform } from "@nestjs/common";

export class BooleanPipe implements PipeTransform<string | number | boolean, boolean> {
  transform(value: string | number | boolean): boolean {
    if (typeof value === 'boolean') return value;
    else if (typeof value === 'string') {
      if (value === "") return false;
      else if (value.toLowerCase() === "true" || value === "1") return true;
      else return false;
    }
    else if (typeof value === 'number') return value === 1;
    else return false;
  }
}