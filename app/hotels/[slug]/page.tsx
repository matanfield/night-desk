import HotelDetail from "@/components/hotel-detail";

export default async function HotelPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <HotelDetail slug={slug} />;
}
