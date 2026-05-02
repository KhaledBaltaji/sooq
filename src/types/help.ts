export interface HelpCollection {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  icon: string;
  locale: string;
  sort_order: number;
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

export interface HelpArticle {
  id: string;
  collection_id: string;
  slug: string;
  title: string;
  content: string;
  sort_order: number;
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

export interface HelpCollectionWithCount extends HelpCollection {
  article_count: number;
}
