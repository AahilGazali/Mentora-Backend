export {};

declare module "socket.io" {
  interface SocketData {
    user: {
      id: string;
      role: "mentor" | "student";
    };
  }
}
