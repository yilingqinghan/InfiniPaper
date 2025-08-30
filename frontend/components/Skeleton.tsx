// frontend/components/Skeleton.tsx
import React from "react";
export default function Skeleton({ className="" }: {className?:string}) {
  return <div className={`relative overflow-hidden bg-gray-200/60 dark:bg-gray-700/50 ${className}`}>
    <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.4s_infinite] bg-gradient-to-r from-transparent via-white/60 to-transparent" />
    <style jsx>{`@keyframes shimmer { 100% { transform: translateX(100%); } }`}</style>
  </div>;
}