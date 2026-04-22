import { supabase } from './supabase';

const BUCKET = 'images';

export async function uploadImage(file: File, folder: string): Promise<string> {
	const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
	const name = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

	const { error } = await supabase.storage.from(BUCKET).upload(name, file, {
		cacheControl: '31536000',
		upsert: false,
	});

	if (error) throw error;

	const { data } = supabase.storage.from(BUCKET).getPublicUrl(name);
	return data.publicUrl;
}

export async function uploadImages(files: FileList | File[], folder: string): Promise<string[]> {
	const arr: File[] = Array.from(files as any as File[]);
	const urls: string[] = [];
	for (const f of arr) {
		urls.push(await uploadImage(f, folder));
	}
	return urls;
}
