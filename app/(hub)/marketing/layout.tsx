import MarketingTabs from "./MarketingTabs";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MarketingTabs />
      {children}
    </>
  );
}
