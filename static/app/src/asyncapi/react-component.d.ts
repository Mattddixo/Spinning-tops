// The parser-free entry point ships without its own path mapping; reuse the package's types.
declare module '@asyncapi/react-component/lib/esm/without-parser' {
  import AsyncApiComponent from '@asyncapi/react-component';
  export default AsyncApiComponent;
}
