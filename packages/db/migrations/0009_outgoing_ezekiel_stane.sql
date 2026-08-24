CREATE INDEX "company_member_user_idx" ON "company_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "prod_member_user_idx" ON "production_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "source_set_production_idx" ON "source_set" USING btree ("production_id");--> statement-breakpoint
CREATE INDEX "sources_production_set_idx" ON "sources" USING btree ("production_id","source_set_id");--> statement-breakpoint
CREATE INDEX "storage_files_production_idx" ON "storage_files" USING btree ("production_id");--> statement-breakpoint
CREATE INDEX "storage_files_folder_idx" ON "storage_files" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "storage_image_versions_file_idx" ON "storage_image_versions" USING btree ("file_id");