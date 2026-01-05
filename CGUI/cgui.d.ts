import * as buffer from "buffer";
import * as selenium from 'selenium-webdriver';

declare namespace CGUI {
    export interface ImageBuffer extends buffer.Buffer {
        buffer: ArrayBuffer,
        width: number,
        height: number
    }
    export interface ImageBuffer2 {
        buffer: ImageBuffer,
        width: number,
        height: number
    }

    interface Rect {
        top: number,
        left: number,
        width: number,
        height: number
    }

    export interface Screen {
        id: string,
        screen: selenium.WebElement,
        screenRect: Rect,
        allElements: selenium.WebElement[],
        allMetadata: Metadata[]
        globalScript: string,
    }

    interface ElementMeta extends Rect {
        id: number,
        type: string,
        dataType: "char*" | "uint8_t" | "uint16_t" | "uint32_t" | "uint64_t" | "int8_t" | "int16_t" | "int32_t" | "int64_t" | "char" | "int",
        code: string
    }

    interface NumberMeta extends ElementMeta {
        type: "number" | "fixed",
        maxLength: number,
        alphabet: string,
        padding?: "left" | "center" | "right",
        zeroFill: boolean
    }

    interface FixedNumberMeta extends NumberMeta {
        type: "fixed",
        digits: number,
    }

    interface StringMeta extends ElementMeta {
        type: "string",
        maxLength: number,
        alphabet: string,
        padding?: "left" | "center" | "right",
        renderer?: string,

        bufferSize: number
    }

    interface GroupMeta extends ElementMeta {
        type: "if",
        cascading: true,

        // background
        fullId: string,
        emptyId: string
    }

    interface ImageMeta extends ElementMeta {
        type: "image",
        condition: Record<string, string>,
        orElse: string,

        images: Record<string, string>,
        orElseImage: string
    }

    interface BarMeta extends ElementMeta {
        type: "bar",
        direction: "top" | "bottom" | "left" | "right",

        fullId: string,
        emptyId: string
    }

    interface ScrollableMeta extends ElementMeta {
        type: "scrollable",
        cascading: true,
        // TODO
    }

    export type Metadata = NumberMeta | FixedNumberMeta | StringMeta | GroupMeta | ImageMeta | BarMeta | ScrollableMeta;
}