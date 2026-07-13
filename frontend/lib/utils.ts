import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function redirectUser(url: string) {
  if (typeof window !== "undefined") {
    window.location.replace(url)
  }
}
