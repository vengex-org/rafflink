declare module "*.sql" {
  /** The file's text, inlined by the bundler. */
  const text: string
  export default text
}
