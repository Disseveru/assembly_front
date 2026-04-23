declare module "*.vue" {
  import Vue from 'vue'
  export default Vue
}

declare module "*.svg?inline" {
  const content: any;
  export default content;
}

declare module "dsa-connect" {
  export type Spell = any;
  export default class DSA {
    constructor(...args: any[]);
    [key: string]: any;
    cast(params: any): Promise<string>;
    Spell(): any;
  }
}