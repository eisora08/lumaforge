type PageContainerProps = {
  children: React.ReactNode;
  className?: string;
};

export default function PageContainer({ children, className = "" }: PageContainerProps) {
  return (
    <div className={`mx-auto w-full max-w-[1900px] px-6 lg:px-8 xl:px-10 lf-page-in ${className}`}>
      {children}
    </div>
  );
}
