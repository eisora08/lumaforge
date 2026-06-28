type PageContainerProps = {
  children: React.ReactNode;
  className?: string;
};

export default function PageContainer({ children, className = "" }: PageContainerProps) {
  return (
    <div className={`mx-auto w-full max-w-[1440px] px-5 lg:px-7 ${className}`}>
      {children}
    </div>
  );
}
